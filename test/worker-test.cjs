const path=require('path')
const fs=require('fs'), {spawn}=require('child_process'), readline=require('readline');
const plugin=path.join(__dirname,'..');
const model=process.env.ASR_MODEL_PATH
const tokens=process.env.ASR_TOKENS_PATH
if(!model||!tokens){console.log('SKIP: set ASR_MODEL_PATH and ASR_TOKENS_PATH to run the ASR worker test');process.exit(0)}
const wav=fs.readFileSync(process.argv[2]||path.join(__dirname,'fixtures','asr_test16.wav'));
let p=12,data,dataLen=0; while(p+8<=wav.length){const id=wav.toString('ascii',p,p+4),n=wav.readInt32LE(p+4); if(id==='data'){data=p+8;dataLen=n;break;} p+=8+n+(n&1);}
const b64=wav.subarray(data,data+dataLen).toString('base64');
const child=spawn(process.execPath,[path.join(plugin,'lib','asr-worker.mjs'),model,tokens,'auto','2'],{cwd:plugin,stdio:['pipe','pipe','inherit'],env:{...process.env}});
const rl=readline.createInterface({input:child.stdout}); let sent=false;
rl.on('line',line=>{console.log('OUT',line.slice(0,300)); const m=JSON.parse(line); if(m.type==='ready'&&!sent){sent=true; child.stdin.write(JSON.stringify({id:'1',sampleRate:16000,pcm:b64})+'\n');} if(m.type==='result'){child.kill(); process.exit(0);} });
setTimeout(()=>{console.log('TIMEOUT');child.kill();process.exit(1)},60000);



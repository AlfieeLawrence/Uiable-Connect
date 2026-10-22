// Headless screenshot driver (dev only, not packaged).
const fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
module.exports = async (win, dir) => {
  fs.mkdirSync(dir, { recursive: true });
  const js = c => win.webContents.executeJavaScript(c);
  const shot = async n => { await wait(900); fs.writeFileSync(path.join(dir, n + '.png'), (await win.webContents.capturePage()).toPNG()); console.log('shot', n); };
  try {
    await shot('01-empty');
    await js(`editServer(); document.querySelector('#n').value='Umbrel box'; document.querySelector('#h').value='127.0.0.1'; document.querySelector('#p').value='2222'; document.querySelector('#u').value='uctest'; document.querySelector('#pass').value='pw123'; document.querySelector('#t').click();`);
    await wait(1500); await shot('02-add-server-test');
    await js(`document.querySelector('#sv').click()`); await wait(500);
    await js(`(async()=>{const l=await uc.call('servers:list'); const f=l[0].forwards; f[0].localPort=18080; f.push({id:'f1',name:'Dev site',remoteHost:'127.0.0.1',remotePort:3000,localPort:3000,auto:false}); await uc.call('servers:forwards', l[0].id, f);
      await uc.call('servers:save',{name:'VPS (key)',host:'127.0.0.1',port:2222,username:'uctest',auth:'key',privateKey:${JSON.stringify(fs.readFileSync('/workspace/tmp/id','utf8'))}}); await refresh(); cur=l[0].id; renderSide(); renderMain();})()`);
    await wait(400); await shot('03-disconnected');
    await js(`connect(cur)`); await wait(4500); await shot('04-overview-connected');
    await js(`S(cur).tab='terminal'; renderMain();`); await wait(1500);
    await js(`uc.send('shell:write', cur, S(cur).activeTerm, 'echo $UC_MARK; uptime; ls -la | head\\n')`); await shot('05-terminal');
    await js(`S(cur).tab='files'; renderMain();`); await wait(800);
    await js(`(async()=>{await uc.call('fs:write',cur,'/home/uctest/.profile_demo','export A=1\\n'); await uc.call('fs:mkdir',cur,'/home/uctest/projects').catch(()=>{}); document.querySelector('#rf').click();})()`); await shot('06-files');
    await js(`editFile(cur,'/home/uctest/.bashrc')`); await shot('07-edit-bashrc');
    await js(`document.querySelector('.modal-bg').remove(); S(cur).tab='forwards'; renderMain();`); await wait(300);
    await js(`document.querySelector('[data-start="0"]').click()`); await wait(1200); await shot('08-forwards');
    await js(`(async()=>{const l=await uc.call('servers:list'); cur=l[1].id; await connect(cur);})()`); await wait(3500); await shot('09-second-server-key');
  } catch (e) { console.error('SHOT ERR', e); }
  require('electron').app.quit();
};

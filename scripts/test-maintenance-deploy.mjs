import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, realpathSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const source = resolve('deploy/integrated/scripts/deploy-maintenance-update.sh')
// Fake Docker only: no daemon, real database, provider or production path is used.
const mock = `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const a=process.argv.slice(2), root=process.env.MOCK_ROOT, mode=process.env.MOCK_MODE;
fs.appendFileSync(path.join(root,'calls'),JSON.stringify(a)+'\\n');
if(a[0]==='inspect'){console.log(a.includes('-f')?'sha256:original':'container sha256:original original-time');process.exit(0)}
if(a[0]==='tag')process.exit(0);
const p=a.indexOf('-f'); const c=a.slice(p+2); const newer=a[p+1].includes('/release/');
if(c[0]==='config')process.exit(0);
if(c[0]==='ps'){if(c.includes('-q'))console.log('container-id');process.exit(0)}
if(c[0]==='build')process.exit(mode==='build-fail'?1:0);
if(c[0]==='exec'){
 const s=c.join(' ');
 if(s.includes('check-worker')){console.log('WORKER_POOLS_READY');process.exit(0)}
 if(s.includes('pg_dump')){console.log('synthetic archive');process.exit(0)}
 if(s.includes('pg_restore')){
  process.stdin.resume();process.stdin.on('end',()=>{if(s.includes('--list'))console.log('TOC');process.exit(mode==='backup-fail'?1:0)});return;
 }
 if(s.includes('psql')){
 let q='';process.stdin.on('data',b=>q+=b);process.stdin.on('end',()=>{
 fs.appendFileSync(path.join(root,'sql'),q+'\\n');
 if(q.includes('assistant_runs'))console.log(mode==='active'?'1':'0');
 else if(q.includes('count(*) FROM users'))console.log('10|10|20|30');
 });return;
 }
 process.exit(0);
}
if(c[0]==='up'&&newer&&c.at(-1)==='server'&&mode==='migration-fail')process.exit(1);
process.exit(0);
`

for (const mode of ['success', 'active', 'build-fail', 'backup-fail', 'migration-fail']) {
  test(`maintenance deploy ${mode}`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sc-deploy-test-')))
    try {
      const bin=join(root,'bin'), old=join(root,'old'), release=join(root,'release'), backups=join(root,'backups')
      for(const dir of [bin,join(old,'deploy/integrated'),join(release,'deploy/integrated/scripts')])mkdirSync(dir,{recursive:true})
      symlinkSync(old,join(root,'startcloudsai'))
      writeFileSync(join(old,'deploy/integrated/.env.integrated'),'APP_SECRET=synthetic-preserve-me\n')
      for(const dir of [old,release])writeFileSync(join(dir,'deploy/integrated/docker-compose.yml'),'name: test\n')
      const script=join(release,'deploy/integrated/scripts/deploy-maintenance-update.sh')
      copyFileSync(source,script)
      const executable=(name,body)=>writeFileSync(join(bin,name),body,{mode:0o755})
      executable('docker',mock)
      executable('curl','#!/bin/sh\nexit 0\n')
      executable('flock','#!/bin/sh\nexit 0\n')
      // GNU options used on the Linux production host; emulate on macOS.
      executable('sed','#!/bin/sh\nexit 0\n')
      executable('sha256sum','#!/bin/sh\nshasum -a 256 "$@"\n')
      executable('mv',`#!/usr/bin/env node
const fs=require('node:fs');const a=process.argv.slice(2).filter(x=>x!=='-Tf');fs.renameSync(a[0],a[1]);
`)
      const result=spawnSync('bash',[script,'123456abcdef'],{encoding:'utf8',timeout:10000,env:{...process.env,
        PATH:bin+':'+process.env.PATH,MOCK_ROOT:root,MOCK_MODE:mode,DEPLOY_ROOT:root,BACKUP_ROOT:backups,DEPLOY_LOCK_FILE:join(root,'lock')}})
      assert.ifError(result.error)
      const calls=readFileSync(join(root,'calls'),'utf8').trim().split('\n').map(JSON.parse)
      const commands=calls.map(c=>c.join(' '))
      const at=part=>commands.findIndex(c=>c.includes(part))
      if(mode==='success'){
        assert.equal(result.status,0,result.stdout+result.stderr)
        assert.match(result.stdout,/DEPLOY_SUCCESS release=123456abcdef/)
        assert.equal(realpathSync(join(root,'startcloudsai')),release)
        assert.ok(at('stop -t 900 worker') < at('pg_dump'))
        assert.ok(at('pg_dump') < at('up -d --no-deps --no-build server'))
        assert.ok(at('check-worker') < at('--force-recreate gateway'))
        assert.match(readFileSync(join(release,'deploy/integrated/.env.integrated'),'utf8'),/APP_SECRET=synthetic-preserve-me/)
        assert.match(readFileSync(join(root,'sql'),'utf8'),/"developer_api".*"removed"/)
      }else{
        assert.notEqual(result.status,0)
        assert.doesNotMatch(result.stdout,/DEPLOY_SUCCESS/)
        if(mode==='active'||mode==='build-fail')assert.equal(at(' stop '),-1)
        if(mode==='backup-fail'){
          assert.ok(at('start server worker gateway')>=0)
          assert.equal(at('up -d --no-deps --no-build server'),-1)
        }
        if(mode==='migration-fail'){
          assert.equal(at('start server worker gateway'),-1)
          assert.match(result.stderr,/No automatic database/)
        }
      }
      assert.equal(at('down'),-1)
      assert.ok(!commands.some(c=>/up .* (postgres|redis|chatgpt2api)$/.test(c)))
      const attempt=join(backups,readdirSync(backups)[0])
      if(mode==='success'||mode==='migration-fail')assert.ok(readFileSync(join(attempt,'production.dump')).length>0)
    } finally {rmSync(root,{recursive:true,force:true})}
  })
}

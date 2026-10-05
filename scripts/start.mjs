import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=process.env.SUPACOMPUTA_HOME || path.join(os.homedir(),'.supercomputer-original');
const pipeline=process.env.SUPACOMPUTA_PIPELINE || path.join(data,'Leo Workflow');
fs.mkdirSync(data,{recursive:true});
fs.mkdirSync(pipeline,{recursive:true});
fs.cpSync(path.join(root,'pipeline-template'),pipeline,{recursive:true,force:false,errorOnExist:false});
process.env.SUPACOMPUTA_HOME=data;
process.env.SUPACOMPUTA_PIPELINE=pipeline;
process.env.SUPACOMPUTA_FRIENDLY_PORT ??= '0';
if(!process.argv.includes('--no-open'))process.argv.push('--open');
await import('../app/server/index.js');

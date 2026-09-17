import { randomUUID, createHash } from 'node:crypto';
import { AccountError, requireId, ownedRecord } from './account-auth.js';
import { verifySummaryEnvelope, signSummary } from './summary.js';

const bucket = 'fynliq-documents';
function check(result) { if (result.error) throw new AccountError(503, 'Could not save your information. Please try again.'); return result.data; }

export async function saveDocument(db, user, input, signingKey) {
  const sourceId = requireId(input.sourceId);
  const existing = check(await db.from('fynliq_documents').select('id').eq('user_id',user.id).eq('source_id',sourceId).maybeSingle());
  if (existing) return { id: existing.id };
  if (input.consent !== true) throw new AccountError(400,'Confirm that you want to save these files to your account.');
  let facts, fileHashes;
  try { ({facts,fileHashes} = verifySummaryEnvelope(input.analysis?.summaryToken, signingKey)); }
  catch { throw new AccountError(400,'This document read has expired. Upload again before saving.'); }
  const files = input.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 3) throw new AccountError(400,'Provide the original files.');
  if(!Array.isArray(fileHashes) || fileHashes.length !== files.length) throw new AccountError(400,'Upload these documents again before saving them.');
  let size = 0;
  const decoded = files.map((file, index) => {
    if (!file || typeof file.name !== 'string' || file.name.length > 180 || !file.name.trim() || typeof file.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new AccountError(400,'Invalid document.');
    const bytes = Buffer.from(file.data,'base64'); size += bytes.length;
    if(createHash('sha256').update(bytes).digest('hex') !== fileHashes[index]) throw new AccountError(400,'The files do not match the document read. Upload again.');
    const valid = file.type === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-'
      : file.type === 'image/png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a'
      : file.type === 'image/jpeg' ? bytes.subarray(0,3).toString('hex') === 'ffd8ff'
      : file.type === 'image/webp' && bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!valid || !bytes.length || size > 2800000) throw new AccountError(400,'Use supported files totaling no more than 2.8 MB.');
    return { bytes, name: file.name, type: file.type, index };
  });
  if (facts.some(f => f.document > files.length)) throw new AccountError(400,'The files do not match this document read.');
  const id = randomUUID(), uploaded = [];
  try {
    for (const file of decoded) {
      const path = `${user.id}/${id}/${file.index}`;
      check(await db.storage.from(bucket).upload(path,file.bytes,{contentType:file.type,upsert:false}));
      uploaded.push({ path, name:file.name, type:file.type, hash:fileHashes[file.index] });
    }
    // Store only server-verified facts. Never persist the expiring bearer summary.
    const analysis = {
      document: {kind:facts[0].kind,fileNames:decoded.map(f=>f.name),readAt:new Date().toISOString(),confidence:0.6},
      student:{firstName:null,school:null},sai: facts.find(f=>f.field==='sai') ? Number(facts.find(f=>f.field==='sai').value.replace(/[$,\s]/g,'')) : null,
      award:{year:facts.find(f=>f.field==='awardYear')?.value || 'Not stated',source:'Saved aid documents',costOfAttendance:null,lines:[]},
      semester:null,unread:[],summaryFacts:facts,reviewed:input.analysis?.reviewed === true,
    };
    const result = await db.from('fynliq_documents').insert({id,user_id:user.id,source_id:sourceId,analysis,files:uploaded});
    if (result.error?.code === '23505') {
      await db.storage.from(bucket).remove(uploaded.map(f=>f.path));
      const winner = check(await db.from('fynliq_documents').select('id').eq('user_id',user.id).eq('source_id',sourceId).single());
      return {id:winner.id};
    }
    check(result);
    return {id};
  } catch (error) { if (uploaded.length) await db.storage.from(bucket).remove(uploaded.map(f=>f.path)); throw error; }
}

export async function loadDocument(db,user,id,signingKey) {
  const row = await ownedRecord(db,'fynliq_documents',user.id,id);
  return { id:row.id, analysis:{...row.analysis,summaryToken:signSummary(row.analysis.summaryFacts,signingKey,Date.now(),row.files.map(f=>f.hash))}, files:row.files.map((f,index)=>({name:f.name,index})) };
}

export async function saveQuestion(db,user,input) {
  requireId(input.id); requireId(input.conversationId);
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length>2000 || !input.answer || !Array.isArray(input.answer.paragraphs) || JSON.stringify(input.answer).length>30000) throw new AccountError(400,'Invalid conversation.');
  const existing = check(await db.from('fynliq_questions').select('id').eq('user_id',user.id).eq('id',input.id).maybeSingle());
  if (existing) return {id:existing.id};
  // Composite foreign key prevents associating a question with somebody else's conversation.
  check(await db.from('fynliq_conversations').upsert({id:input.conversationId,user_id:user.id},{onConflict:'id',ignoreDuplicates:true}));
  await ownedRecord(db,'fynliq_conversations',user.id,input.conversationId);
  const result = await db.from('fynliq_questions').upsert({id:input.id,user_id:user.id,conversation_id:input.conversationId,question:input.question,answer:input.answer},{onConflict:'id',ignoreDuplicates:true});
  check(result);
  await ownedRecord(db,'fynliq_questions',user.id,input.id);
  return {id:input.id};
}

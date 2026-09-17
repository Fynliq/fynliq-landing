import { accountClients, authenticatedUser, accountBody, AccountError, ownedRecord } from '../server/account-auth.js';
import { saveDocument, loadDocument, saveQuestion } from '../server/account-service.js';
import { allowRequest } from '../server/limits.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  try {
    if (!['GET','POST'].includes(req.method)) throw new AccountError(405,'Use GET or POST.');
    if (!allowRequest(req,'account',40)) throw new AccountError(429,'Please wait a minute and try again.');
    const {auth,db} = accountClients();
    const user = await authenticatedUser(req,auth);
    const action = req.query.action;
    if (action === 'list' && req.method === 'GET') {
      const [documents,questions] = await Promise.all([
        db.from('fynliq_documents').select('id,created_at,files').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
        db.from('fynliq_questions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
      ]);
      if (documents.error || questions.error) throw new AccountError(503,'Could not load saved information.');
      return res.json({documents:documents.data.map(d=>({id:d.id,created_at:d.created_at,names:d.files.map(f=>f.name)})),questions:questions.data});
    }
    const body = accountBody(req, action === 'save-document' ? 4000000 : 100000);
    if (action === 'save-document' && req.method === 'POST') return res.json(await saveDocument(db,user,body,process.env.OPENAI_API_KEY));
    if (action === 'load-document' && req.method === 'POST') return res.json(await loadDocument(db,user,body.id,process.env.OPENAI_API_KEY));
    if (action === 'save-question' && req.method === 'POST') return res.json(await saveQuestion(db,user,body));
    if (action === 'delete-document' && req.method === 'POST') {
      const doc = await ownedRecord(db,'fynliq_documents',user.id,body.id);
      const {error:storageError} = await db.storage.from('fynliq-documents').remove(doc.files.map(f=>f.path));
      if(storageError) throw new AccountError(503,'Could not remove the saved files. Try again.');
      const {error} = await db.from('fynliq_documents').delete().eq('user_id',user.id).eq('id',doc.id);
      if(error) throw new AccountError(503,'Could not remove the saved summary. Try again.');
      return res.json({ok:true});
    }
    if (action === 'delete-question' && req.method === 'POST') {
      const row = await ownedRecord(db,'fynliq_questions',user.id,body.id);
      const {error} = await db.from('fynliq_questions').delete().eq('user_id',user.id).eq('id',row.id);
      if(error) throw new AccountError(503,'Could not remove the saved question. Try again.');
      return res.json({ok:true});
    }
    if (action === 'download' && req.method === 'POST') {
      const doc = await ownedRecord(db,'fynliq_documents',user.id,body.id);
      const file = Number.isInteger(body.index) && doc.files[body.index];
      if (!file) throw new AccountError(404,'File not found.');
      const {data,error} = await db.storage.from('fynliq-documents').download(file.path);
      if (error) throw new AccountError(503,'Could not download this file.');
      res.setHeader('Content-Type',file.type);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Disposition',`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      return res.send(Buffer.from(await data.arrayBuffer()));
    }
    throw new AccountError(400,'Unknown account action.');
  } catch(error) { return res.status(error instanceof AccountError ? error.status : 503).send(error instanceof AccountError ? error.message : 'Account service is temporarily unavailable.'); }
}

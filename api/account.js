// Saving documents/conversations is outside the content-free closed beta.
export default function handler(req,res){res.setHeader('Cache-Control','no-store');return res.status(410).send('Saving files, questions and answers is disabled for this beta.');}

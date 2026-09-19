// Raw PDFs/images cannot be screened safely by the Phase 1 text PII gate.
export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  return res.status(503).send('Document processing is temporarily unavailable while we add privacy checks. You can still ask general financial-aid questions in Ask Fynliq. Do not paste sensitive identifiers.');
}

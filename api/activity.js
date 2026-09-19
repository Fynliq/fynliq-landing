// Authoritative usage events are recorded inside authenticated server actions.
export default function handler(req,res){res.setHeader('Cache-Control','no-store');return res.status(410).send('Client activity collection is disabled.');}

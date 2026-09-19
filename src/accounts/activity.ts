// Usage is recorded by authenticated server actions, never browser content.
export function beginActivity(_userId:string|null){}
export async function activity(_event:string,_id?:string){}

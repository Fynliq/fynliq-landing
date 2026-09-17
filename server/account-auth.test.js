import { describe,it,expect,vi } from 'vitest';
import { authenticatedUser,ownedRecord,accountBody,accountClients } from './account-auth.js';
import { anonymousIdentity } from '../api/activity.js';
import { createHmac } from 'node:crypto';

describe('private account boundary',()=>{
  it('fails closed when accounts are unconfigured',()=>{expect(()=>accountClients({})).toThrow('not available');});
  it('rejects missing and invalid authorization',async()=>{
    const auth={auth:{getUser:vi.fn().mockResolvedValue({data:{user:null},error:new Error()})}};
    await expect(authenticatedUser({headers:{}},auth)).rejects.toMatchObject({status:401});
    await expect(authenticatedUser({headers:{authorization:'Bearer forged'}},auth)).rejects.toMatchObject({status:401});
  });
  it('uses the provider-verified user, never a request user_id',async()=>{
    const auth={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'actual-user'}},error:null})}};
    expect((await authenticatedUser({headers:{authorization:'Bearer valid'},body:{user_id:'victim'}},auth)).id).toBe('actual-user');
  });
  it('cannot look up another owner by changing an item id',async()=>{
    const filters=[];
    const query={select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query;},maybeSingle:async()=>({data:null,error:null})};
    const db={from:()=>query};
    await expect(ownedRecord(db,'fynliq_documents','user-a','12345678-1234-4234-8234-123456789abc')).rejects.toMatchObject({status:404});
    expect(filters).toContainEqual(['user_id','user-a']);
  });
  it('rejects oversized and malformed requests',()=>{
    expect(()=>accountBody({headers:{'content-type':'application/json'},body:'bad json'})).toThrow();
    expect(()=>accountBody({headers:{'content-type':'application/json'},body:{data:'x'.repeat(100)}},20)).toThrow();
  });
  it('does not accept a forged anonymous identity cookie',()=>{
    const secret='s'.repeat(32),id='12345678-1234-4234-8234-123456789abc';
    expect(anonymousIdentity(`fynliq_visitor=${id}.forged`,secret)).not.toBe(id);
    const signature=createHmac('sha256',secret).update(id).digest('base64url');
    expect(anonymousIdentity(`fynliq_visitor=${id}.${signature}`,secret)).toBe(id);
  });
});

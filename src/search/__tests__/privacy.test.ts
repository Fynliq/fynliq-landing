import {afterEach,expect,it,vi} from 'vitest';
import {httpAnalytics} from '../httpAnalytics';
afterEach(()=>vi.unstubAllGlobals());
it('search analytics never transmit entered text, timestamps or arbitrary identifiers',()=>{
  const send=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',send);
  httpAnalytics('/api/search').record({query:'SYNTHETIC_PRIVATE_QUESTION',questionId:'SYNTHETIC_PRIVATE_ID',kind:'search',at:'SYNTHETIC_PRIVATE_TIME'});
  expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({kind:'search',questionId:null});
  expect(send.mock.calls[0][1].body).not.toContain('SYNTHETIC_PRIVATE');
});

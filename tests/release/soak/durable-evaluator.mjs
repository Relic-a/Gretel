import {isDeepStrictEqual} from 'node:util';
export function verifyAcknowledgedRows(ledger, readRow) {
 if (!ledger.length) return {ok:false,reason:'No acknowledged durable writes'};
 for (const item of ledger) {
  const row=readRow(item.profileId,item.videoId);
  if (!item.row || !isDeepStrictEqual(row,item.row)) return {ok:false,reason:`Acknowledged durable record changed or disappeared: ${item.videoId}`};
 }
 return {ok:true};
}

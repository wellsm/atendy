import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PanelProvider } from '../../panel/provider';
import type { PanelIdentity } from '../../panel/types';
import type { PosBarcodeCandidate } from '../barcode';

import { HttpBadRequestError } from '@ez4/gateway';

import { requireStore } from '../../panel/store';
import { resolvePosBarcode } from '../barcode';

export declare class FindPosBarcodeRequest implements Http.Request {
  identity: PanelIdentity;
  parameters: {
    code: string;
  };
}

export declare class FindPosBarcodeResponse implements Http.Response {
  status: 200;
  body: {
    candidates: PosBarcodeCandidate[];
  };
}

export async function findPosBarcodeHandler(
  request: Http.Incoming<FindPosBarcodeRequest>,
  { db }: Service.Context<PanelProvider>
): Promise<FindPosBarcodeResponse> {
  const store = await requireStore(db, request.identity);
  const { code } = request.parameters;

  if (!/^\d{6,20}$/.test(code)) {
    throw new HttpBadRequestError('Invalid barcode', { field: 'code' });
  }

  return { status: 200, body: { candidates: await resolvePosBarcode(db, store.id, code) } };
}

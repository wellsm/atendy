import { HttpBadRequestError, HttpConflictError, HttpError, HttpForbiddenError } from '@ez4/gateway';

import { WebOrderError, WebOrderErrorCode } from './web-order';
import { PricingError, PricingErrorCode } from '../orders/pricing';
import { OrderError, OrderErrorCode } from '../orders/repository';

const TOO_MANY = new Set([
  WebOrderErrorCode.TooMany,
  WebOrderErrorCode.ResendWait,
  WebOrderErrorCode.TooManyCodes,
  WebOrderErrorCode.TooManyAttempts
]);

const BAD_REQUEST = new Set([WebOrderErrorCode.Phone, WebOrderErrorCode.CodeInvalid, WebOrderErrorCode.CodeExpired]);

const soldOutContext = (subject?: string) => ({ field: 'items', names: subject ? [subject] : [] });

/**
 * Runs a public order call; domain errors become HTTP errors whose `field` the checkout shows.
 */
export const withWebOrderErrors = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WebOrderError) {
      if (TOO_MANY.has(error.code)) {
        throw new HttpError(429, error.message, { field: error.code });
      }

      if (BAD_REQUEST.has(error.code)) {
        throw new HttpBadRequestError(error.message, { field: error.code });
      }

      if (error.code === WebOrderErrorCode.PhoneUnverified) {
        throw new HttpForbiddenError(error.message, { field: error.code });
      }

      if (error.code === WebOrderErrorCode.CodeSendFailed) {
        throw new HttpError(503, error.message, { field: error.code });
      }

      throw new HttpConflictError(error.message, { field: error.code });
    }

    // Sold out is about the cart's lines: the checkout shows the message next to the items, in Portuguese, and
    // marks the lines whose product or option is in `names`.
    if (error instanceof PricingError && error.code === PricingErrorCode.SoldOut) {
      throw new HttpBadRequestError(`Esgotado: ${error.subject ?? 'item'}.`, soldOutContext(error.subject));
    }

    if (error instanceof PricingError && error.code === PricingErrorCode.OptionSoldOut) {
      throw new HttpBadRequestError(`Esgotado: ${error.subject ?? 'opção'}.`, soldOutContext(error.subject));
    }

    if (error instanceof OrderError && error.code === OrderErrorCode.OutOfStock) {
      throw new HttpBadRequestError(`Acabou: ${error.names?.join(', ') ?? 'item'}.`, {
        field: 'items',
        names: error.names ?? []
      });
    }

    if (error instanceof OrderError || error instanceof PricingError) {
      throw new HttpBadRequestError(error.message, { field: error.code });
    }

    throw error;
  }
};

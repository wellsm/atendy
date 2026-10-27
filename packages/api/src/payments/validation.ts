import type { CardHolderInput, CardInput } from './types';

/**
 * A card form field the owner must fix; the endpoint turns it into a 400 naming the field.
 */
export class PaymentError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
  }
}

const digits = (value: string) => value.replace(/\D/g, '');

/**
 * Luhn check: catches typos before Asaas is called.
 */
const isLuhnValid = (number: string) => {
  let sum = 0;

  for (let index = 0; index < number.length; index++) {
    let digit = Number(number[number.length - 1 - index]);

    if (index % 2 === 1) {
      digit *= 2;
      digit = digit > 9 ? digit - 9 : digit;
    }

    sum += digit;
  }

  return sum % 10 === 0;
};

/**
 * Normalised holder and card data, or `PaymentError(field)`. The card itself is never stored.
 */
export const validateCardForm = (holder: CardHolderInput, card: CardInput, now: Date) => {
  const name = holder.name.trim();
  const cpfCnpj = digits(holder.cpfCnpj);
  const email = holder.email.trim();
  const phone = digits(holder.phone);
  const postalCode = digits(holder.postalCode);
  const addressNumber = holder.addressNumber.trim();
  const number = digits(card.number);
  const holderName = card.holderName.trim();
  const expiryMonth = digits(card.expiryMonth).padStart(2, '0');
  const expiryYear = digits(card.expiryYear);
  const ccv = digits(card.ccv);

  if (name.length < 3) {
    throw new PaymentError('holder.name', 'Holder name is required');
  }

  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    throw new PaymentError('holder.cpf_cnpj', 'CPF or CNPJ must have 11 or 14 digits');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PaymentError('holder.email', 'Invalid email');
  }

  if (phone.length < 10 || phone.length > 11) {
    throw new PaymentError('holder.phone', 'Phone must have DDD and number');
  }

  if (postalCode.length !== 8) {
    throw new PaymentError('holder.postal_code', 'CEP must have 8 digits');
  }

  if (!addressNumber) {
    throw new PaymentError('holder.address_number', 'Address number is required');
  }

  if (number.length < 13 || number.length > 19 || !isLuhnValid(number)) {
    throw new PaymentError('card.number', 'Invalid card number');
  }

  if (holderName.length < 3) {
    throw new PaymentError('card.holder_name', 'Name on the card is required');
  }

  const month = Number(expiryMonth);
  const year = Number(expiryYear.length === 2 ? `20${expiryYear}` : expiryYear);
  const expired = year < now.getUTCFullYear() || (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1);

  if (month < 1 || month > 12 || String(year).length !== 4 || expired) {
    throw new PaymentError('card.expiry', 'Invalid or expired card');
  }

  if (ccv.length < 3 || ccv.length > 4) {
    throw new PaymentError('card.ccv', 'Invalid security code');
  }

  return {
    holder: { name, cpfCnpj, email, phone, postalCode, addressNumber },
    card: { holderName, number, expiryMonth, expiryYear: String(year), ccv }
  };
};

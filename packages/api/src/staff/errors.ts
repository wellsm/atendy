/**
 * An employee write or PIN check the caller must fix. `field` is the wire name (`pin`, `blocked`, `manager_required`...).
 */
export class StaffError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(message);
  }
}

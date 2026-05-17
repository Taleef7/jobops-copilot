const singleRecipientEmailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function isSingleRecipientEmailAddress(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /[,\s;]/.test(trimmed)) {
    return false;
  }

  return singleRecipientEmailPattern.test(trimmed);
}

export function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32)
}

export function safeDestination(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /\s/.test(value) || hasControlCharacters(value)) return '/dashboard'
  const path = value.split(/[?#]/)[0]
  return /^\/(?:dashboard|ai-assistant|requests(?:\/new|\/[1-9]\d*(?:\/edit)?)?|knowledge-base(?:\/[1-9]\d*)?)$/.test(path) ? value : '/dashboard'
}

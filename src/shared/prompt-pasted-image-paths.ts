const IMAGE_EXTENSION = '(?:png|jpe?g|gif|webp|bmp)'

// Why these two shapes: Claude's job launcher and Orca's terminal paste both save
// the image and put its path into the prompt. Their folders can carry spaces (a
// user name), so the path is matched up to the basename they generate.
const GENERATED_IMAGE_PATH = new RegExp(
  `(?:[A-Za-z]:[\\\\/]|/)[^\\n]*?(?:[\\\\/]pasted-\\d+|[\\\\/]orca-paste-[0-9a-f-]+)\\.${IMAGE_EXTENSION}(?=\\s|$)`,
  'gi'
)
// Why whitespace-free only: any other image path is dropped as a token, so words
// around a path that merely mentions a folder are never taken with it.
const IMAGE_PATH_TOKEN = new RegExp(
  `(?:^|\\s)(?:[A-Za-z]:[\\\\/]|/)\\S+\\.${IMAGE_EXTENSION}(?=\\s|$)`,
  'gi'
)
const MAYBE_IMAGE = new RegExp(`\\.${IMAGE_EXTENSION}(?![A-Za-z0-9])`, 'i')

/**
 * The prompt without the image paths a paste put into it.
 *
 * A prompt that starts with `C:\Users\me\.claude\jobs\d8ade130\pasted-1.png` names
 * its terminal "C Users me" - the path, not what was asked. Claude's own job list
 * shows `[Image #1]` in its place; here the words that follow are enough.
 */
export function stripPastedImagePaths(prompt: string): string {
  if (!MAYBE_IMAGE.test(prompt)) {
    return prompt
  }
  const stripped = prompt
    .replace(GENERATED_IMAGE_PATH, ' ')
    .replace(IMAGE_PATH_TOKEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > 0 ? stripped : prompt
}

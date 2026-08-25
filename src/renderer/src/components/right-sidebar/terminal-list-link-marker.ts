/**
 * Marks a link rendered under a terminal's list row.
 *
 * Why its own module: the row's right-click handler runs in the capture phase
 * and has to recognise the link before the link's own menu can, and the row must
 * not import the link chip (and everything it routes through) to learn the name.
 */
export const TERMINAL_LIST_LINK_ATTR = 'data-terminal-list-link'

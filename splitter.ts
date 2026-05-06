/**
 * Split a compound bash command into individual command segments.
 *
 * Respects single quotes, double quotes, and backslash escapes.
 * Splits on command separators: &&, ||, |, |&, ;, ;;, &, and newlines.
 * Does NOT split on redirect operators like >, <, >>, <<, >&, <&, &>.
 *
 * Empty or whitespace-only segments are filtered out.
 */
export function splitBashCommand(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escape = false;

	let i = 0;
	while (i < command.length) {
		const c = command[i];

		if (escape) {
			current += c;
			escape = false;
			i++;
			continue;
		}

		if (c === "\\") {
			current += c;
			escape = true;
			i++;
			continue;
		}

		if (inSingleQuote) {
			current += c;
			if (c === "'") {
				inSingleQuote = false;
			}
			i++;
			continue;
		}

		if (inDoubleQuote) {
			current += c;
			if (c === '"') {
				inDoubleQuote = false;
			}
			i++;
			continue;
		}

		if (c === "'") {
			current += c;
			inSingleQuote = true;
			i++;
			continue;
		}

		if (c === '"') {
			current += c;
			inDoubleQuote = true;
			i++;
			continue;
		}

		const sepLen = getSeparatorLength(command, i);
		if (sepLen > 0) {
			const trimmed = current.trim();
			if (trimmed) {
				segments.push(trimmed);
			}
			current = "";
			i += sepLen;
			continue;
		}

		current += c;
		i++;
	}

	const trimmed = current.trim();
	if (trimmed) {
		segments.push(trimmed);
	}

	return segments;
}

function getSeparatorLength(s: string, i: number): number {
	const c = s[i];
	const next = s[i + 1];

	// Multi-character separators
	if (c === "&" && next === "&") return 2; // &&
	if (c === "|" && next === "|") return 2; // ||
	if (c === "|" && next === "&") return 2; // |&
	if (c === ";" && next === ";") return 2; // ;;

	// Single-character separators
	if (c === "|") return 1; // |
	if (c === ";") return 1; // ;
	if (c === "\n") return 1; // newline
	if (c === "\r" && next === "\n") return 2; // \r\n

	// & is a background separator unless part of a redirect operator
	if (c === "&") {
		if (next === ">") return 0; // &> redirect
		if (i > 0) {
			const prev = s[i - 1];
			if (prev === ">" || prev === "<") return 0; // >& or <& redirect
		}
		return 1; // & background
	}

	return 0;
}

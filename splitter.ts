/**
 * Split a compound bash command into individual command segments.
 *
 * Respects:
 * - Single quotes ('...') and double quotes ("...")
 * - Backslash escapes (\&, \|, etc.)
 * - Back-ticks (`...`) for command substitution
 * - Command substitution $(...) and arithmetic expansion $((...))
 * - Heredocs (<<EOF ... EOF)
 *
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
	let inBackTick = false;
	let inCommandSub = false;
	let inArithmetic = false;
	let parenDepth = 0;
	let escape = false;
	let inHeredoc = false;
	let heredocDelimiter = "";
	let heredocPending = false;

	let i = 0;
	while (i < command.length) {
		const c = command[i];

		// Heredoc body mode: skip everything until we find the delimiter at the start of a line
		if (inHeredoc) {
			current += c;

			if (c === "\n") {
				// Check if the next line starts with the delimiter (allowing leading whitespace for <<-)
				const lineStart = i + 1;
				let k = lineStart;
				while (k < command.length && (command[k] === " " || command[k] === "\t")) {
					k++;
				}

				if (
					command.substring(k, k + heredocDelimiter.length) === heredocDelimiter &&
					(k + heredocDelimiter.length >= command.length ||
						command[k + heredocDelimiter.length] === "\n" ||
						command[k + heredocDelimiter.length] === "\r" ||
						command[k + heredocDelimiter.length] === " " ||
						command[k + heredocDelimiter.length] === "\t" ||
						command[k + heredocDelimiter.length] === ";" ||
						command[k + heredocDelimiter.length] === "&" ||
						command[k + heredocDelimiter.length] === "|")
				) {
					// Include only the delimiter in current, then exit heredoc mode
					for (let d = 0; d < heredocDelimiter.length; d++) {
						current += command[k + d];
					}
					i = k + heredocDelimiter.length - 1; // -1 because loop will increment
					inHeredoc = false;
					heredocDelimiter = "";
				}
			}

			i++;
			continue;
		}

		// When we've seen << or <<- on a line and then hit a newline, enter heredoc body mode
		if (heredocPending && c === "\n") {
			heredocPending = false;
			inHeredoc = true;
			current += c;
			i++;
			continue;
		}

		// Also handle \r\n for heredoc pending
		if (heredocPending && c === "\r" && i + 1 < command.length && command[i + 1] === "\n") {
			heredocPending = false;
			inHeredoc = true;
			current += "\r\n";
			i += 2;
			continue;
		}

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

		if (inBackTick) {
			current += c;
			if (c === "`") {
				inBackTick = false;
			}
			i++;
			continue;
		}

		if (inCommandSub || inArithmetic) {
			current += c;
			if (c === "(") {
				parenDepth++;
			} else if (c === ")") {
				parenDepth--;
				if (parenDepth === 0) {
					inCommandSub = false;
					inArithmetic = false;
				}
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

		if (c === "`") {
			current += c;
			inBackTick = true;
			i++;
			continue;
		}

		// Detect command substitution $(...) and arithmetic expansion $((...))
		if (c === "$" && i + 1 < command.length && command[i + 1] === "(") {
			current += c;
			i++;
			current += command[i]; // (
			if (i + 1 < command.length && command[i + 1] === "(") {
				// $(( - arithmetic expansion
				i++;
				current += command[i]; // second (
				inArithmetic = true;
				parenDepth = 2;
			} else {
				// $( - command substitution
				inCommandSub = true;
				parenDepth = 1;
			}
			i++;
			continue;
		}

		// Detect heredoc: <<EOF or <<-EOF
		// Only detect when not in quotes/subshells and when << is not part of a longer token
		if (
			c === "<" &&
			i + 1 < command.length &&
			command[i + 1] === "<" &&
			!inSingleQuote &&
			!inDoubleQuote &&
			!inBackTick &&
			!inCommandSub &&
			!inArithmetic
		) {
			// Check if it's << or <<-
			let j = i + 2;
			if (j < command.length && command[j] === "-") {
				j++; // skip the dash
			}

			// Skip whitespace after << or <<-
			while (j < command.length && (command[j] === " " || command[j] === "\t")) {
				j++;
			}

			// Parse the delimiter
			let delimStart = j;
			while (
				j < command.length &&
				command[j] !== "\n" &&
				command[j] !== "\r" &&
				command[j] !== " " &&
				command[j] !== "\t" &&
				command[j] !== ";" &&
				command[j] !== "&" &&
				command[j] !== "|"
			) {
				j++;
			}

			if (j > delimStart) {
				heredocDelimiter = command.substring(delimStart, j);
				// Include <<, optional -, and delimiter in current
				current += command.substring(i, j);
				i = j;
				heredocPending = true;
				continue;
			}
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

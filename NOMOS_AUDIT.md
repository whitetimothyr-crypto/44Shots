NOMOS 44 SHOTS: STRICT RULES
FORBIDDEN CHARACTER (EXTERNAL ONLY): The em dash is prohibited in all user-facing UI, branding strings, and external communications. It is acceptable in internal code comments or package metadata.

FORBIDDEN WORD: The word "THE" is prohibited in all UI text, branding, and page titles (language without value).

COORDINATE SPACE: Shot coordinates must map to a 1000x425 SVG viewBox. Do not corrupt this space during extraction.

ATOMIC MOVES: Do not refactor UI and Math at the same time. Move pure logic to @/lib first.

READ-ONLY MONOLITH: index.html is read-only until a component is fully extracted, verified, and running in the Next.js app.

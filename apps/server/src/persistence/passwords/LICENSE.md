# Common passwords: source and licence

`commonPasswords.txt` is `Passwords/Common-Credentials/10k-most-common.txt` from **SecLists** by Daniel Miessler,
Jason Haddix and contributors, https://github.com/danielmiessler/SecLists, unchanged: 10,001 lines, one password
each (CC-261, ADR-080). It was taken on 2026-10-21 from the `master` branch, whose last change to the file was
commit `913b327317496d062bcc7cace524aaad8a693be2` (2026-09-08). SHA-256 of the file:
`68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`.

The server refuses these passwords at sign-up and on a password change. Only the entries of 8 characters or more
can matter, because shorter passwords are refused anyway. The list stays on the server and is never sent to a
browser.

SecLists is released under the MIT License, whose notice follows.

```text
MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

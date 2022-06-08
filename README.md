# Web SMART Health Card Verifier

This is a quickly hacked-together [SMART Health Card
Verifier](https://smarthealth.cards/en/), implemented for Firefly Arts
Collective's 2022 gathering.  It's not directly re-usable without
changing how the back-end interacts with the database, but I'd like to
preserve it in a repo and perhaps it can serve as a warning to
others...

Both front- and back-end definitely have carried technical debt in
terms of required refactoring (and omg automated tests). For a weekend
project and not knowing anything about Node.js beforehand, though, I'm
pretty pleased with the result.


## Front-end Web Page

scanner.php: This is a page fragment; it is designed to be included in
an enclosing DIV by a PHP application (the Ticketing and Volunteering
Portal).  The only PHP here is to fill in some system variables, most
importantly $this->user['id'].

The front-end depends on the excellent [Nimiq QR
Scanner](https://github.com/nimiq/qr-scanner) for QR code recognition.
There is then some increasingly obtuse JavaScript and criminal
type-abuse to try and massage file uploads, including a whole damn PDF
renderer.


## Back-end Server

This is a tiny server that accepts JSON requests with the content
of a SMART Health Card, verifies the card signature, validates that
it is a complete immunization record, and checks the user identity
against the ticketing database.  If the immunization record is
complete and name and DOB match, the card is accepted.  If the DOB
matches but the name does not, it is held for manual
review. Otherwise, the card is rejected.

We currently act with the UID passed in the request, even though
this could be faked.  We could extract a trusted UID from the
session cookie, but it doesn't really matter because a fake uid
definitely won't match name+DOB. The UID field is simply for
convenience in locating the user record.

Input JSON fields:
- **uid**:     ticket system UID for the logged-in user
- **qrdata**:  QR code data, expected to be "shc:/[0-9]*"

Output fields:
- **status**:
  - "verified" - All checks passed and the user has been marked as
   verified in the database
  - "name-mismatch" - The card is valid and DOB match but name did not
   match the database exactly
  - "failed"   - Some aspect of verification failed
- **message**: an informational message suitable for display

Pretty much everything is hardcoded in this application and it's
totally just a hack for 2022.

This is all quite dependent on the existing application's database
schema.

The back-end depends on Larry Joy's [SMART Health Card
Decoder](https://github.com/smart-on-fhir/smart-health-card-decoder)
library.

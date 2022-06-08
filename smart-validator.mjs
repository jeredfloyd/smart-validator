// smart-validator for Firefly Ticketing
//
// This is a tiny server that accepts JSON requests with the content
// of a SMART Health Card, verifies the card signature, validates that
// it is a complete immunization record, and checks the user identity
// against the ticketing database.  If the immunization record is
// complete and name and DOB match, the card is accepted.  If the DOB
// matches but the name does not, it is held for manual
// review. Otherwise, the card is rejected.
//
// We currently act with the UID passed in the request, even though
// this could be faked.  We could extract a trusted UID from the
// session cookie, but it doesn't really matter because a fake uid
// definitely won't match name+DOB. The UID field is simply for
// convenience.
//
// Input JSON fields:
// - uid:     ticket system UID for the logged-in user
// - qrdata:  QR code data, expected to be "shc:/[0-9]*"
//
// Output fields:
// - status:  "verified" - All checks passed and the user has been
//                         marked as verified in the database
//            "name-mismatch" - The card is valid and DOB match but
//                         name did not match the database exactly
//            "failed"   - Some aspect of verification failed
// - message: an informational message suitable for display
//
// Pretty much everything is hardcoded in this application and it's
// totally just a hack for 2022.

// config "file" so I can check in this code without DB creds
import dbConfig from './dbconfig.json' assert {type: "json"};

import {verify, Directory} from 'smart-health-card-decoder'
import card from 'smart-health-card-decoder/esm/card.js'
import http from 'http';
import mysql from 'mysql';
import nodemailer from 'nodemailer';

// Takes a integer uid, VerificationRecord vrec, Callback callback
// Calls back with JSON response
// Side-effects, database update for successful validation
function processCard(uid, vrec, callback) {
    if (vrec.verified === false) {
        callback({
           "status": "failed",
           "message": "SMART Health Card failed validation: " + vrec.reason
        });
        return;
    }

    // Is this an Immunizations Card? We don't accept tests here.
    const resultCard = card(vrec.data);
    if (!resultCard) {
        callback ({
           "status": "failed",
           "message": "Card is not an Immunizations Card"
        });
        return;
    }

    // check if this qualifies as fully immunized
    // https://www.cdc.gov/coronavirus/2019-ncov/vaccines/stay-up-to-date.html
    // We'll accept 2 doses of any listed COVID-19 vaccine, or
    // 1 dose of J&J (cvx 212), as per CDC recommendations
    //
    // The library we're using pre-loads only the COVID-19 entries, so we don't
    // have to do a lot of validation here
    var shotCount = 0;
    for (let i=0; i<resultCard.immunizations.length; i++) {
        // Skip records that weren't in the cvxDefaultCodes
        if (resultCard.immunizations[i].manufacturer == 'unknown') continue;
        // Count J&J as an extra shot toward a primary series
        if (resultCard.immunizations[i].manufacturer == 'Janssen') shotCount++;
        shotCount++;
    }
    if (shotCount < 2) {
        callback ({
           "status": "failed",
           "message": "unable to verify a full primary series immunization"
        });
        return;
    }
    
    // Retrieve record for this uid
    // Connect to the database
    var con = mysql.createConnection(dbConfig);
    con.connect(function(err) {
	if (err) {
	    callback ({
		"status": "failed",
    		"message": "problem connecting to database: " + err.code
	    });
	    return;
	}

	// Retrieve the user record
	const sql = "SELECT fullname,dob,type FROM users JOIN covidauth ON users.id=covidauth.user WHERE id = ?";
	con.query(sql, [uid], function (err, results) {
	    if (err) {
		callback ({
		    "status": "failed",
    		    "message": "problem querying database: " + err.code
		});
		// release database connection
		con.end();
		return;
	    }

	    if (results.length != 1) {
		callback ({
		    "status": "failed",
    		    "message": "couldn't find user identity: " + uid
		});
		// release database connection
		con.end();
		return;
	    }

	    // check DOB - resultCard.patient.dob
	    const myDate = results[0].dob;
	    const resultDob = new Date(Date.UTC(myDate.getFullYear(),myDate.getMonth(), myDate.getDate()));
	    const cardDob = resultCard.patient.dob;
	    if (resultDob.getTime() != cardDob.getTime()) {
		callback ({
		    "status": "failed",
    		    "message": "patient date of birth does not match participant DOB"
		});
		// release database connection
		con.end();
		return;
	    }

	    // check name - resultCard.patient.name
	    //
	    // Unfortunately the card class composes the name as
	    // "family, given" which doesn't really work for us. Since
	    // we have to go through the FHIR data anyway, lets go
	    // ahead and try matching against iterative extensions of
	    // given names.
	    //
	    // This will match if the Health Card has more given names
	    // than we do.  If we have more names, this will still
	    // mismatch and require manual review.
	    //
	    // Copypasta from the card class to extract patient name
	    // from the context object; this has been validated above
	    const patientEntry = vrec.data.fhirBundle.entry.find(entry => entry.resource?.resourceType === 'Patient');
	    const patientResource = patientEntry.resource;
	    var patientName;
	    const numGivens = patientResource.name?.[0]?.given.length || 0;
	    // Try to handle mononymics gracefully
	    for (let i=0; i<=numGivens; i++) {
		patientName =  patientResource.name?.[0]?.given.slice(0,i).join(' ');
		if (patientName.length > 0) {
		    patientName += ' ';
		}
		patientName += patientResource.name?.[0]?.family;

		// ignore case, accents and punctuation
		if (0 == results[0].fullname.localeCompare(patientName, undefined, { sensitivity: 'base', ignorePunctuation: 'true' })) {
		    // We got a match!
		    const sql2 = "UPDATE covidauth SET type = 'vaccination', status = 'verified', message = NULL WHERE user = ?";
		    con.query(sql2, [uid], function (err) {
			// release database connection
			con.end();
			
			if (err) {
			    callback ({
				"status": "failed",
    				"message": "problem updating database: " + err.code
			    });
			    return;
			}
		    
			callback({
			    "status": "success",
			    "message": "signature validated"
			});
			return;
		    });
		    return;
		}
	    }

	    // Try again just matching first and last components (this should probably replace the above logic entirely)
	    patientName = patientResource.name?.[0]?.given?.[0];
	    if (patientName.length > 0) {
		patientName += ' ';
	    }
	    patientName += patientResource.name?.[0]?.family;
	    var fullNameParts = results[0].fullname.split(' ');
	    var fullname = fullNameParts[0];
	    if (fullNameParts.length > 1) {
		fullname += ' ' + fullNameParts[fullNameParts.length - 1];
	    }
	    // ignore case, accents and punctuation
	    if (0 == fullname.localeCompare(patientName, undefined, { sensitivity: 'base', ignorePunctuation: 'true' })) {
		// We got a match!
		const sql2 = "UPDATE covidauth SET type = 'vaccination', status = 'verified', message = NULL WHERE user = ?";
		console.log("matched");
		con.query(sql2, [uid], function (err) {
		    // release database connection
		    con.end();
		    
		    if (err) {
			callback ({
			    "status": "failed",
    			    "message": "problem updating database: " + err.code
			});
			return;
		    }
		    
		    callback({
			"status": "success",
			"message": "signature validated"
		    });
		    return;
		});
		return;
	    }
	    
	    // We failed to match the name
	    const sql2 = "UPDATE covidauth SET status = 'name-mismatch', message = ? WHERE user = ?";
	    con.query(sql2, [patientName, uid], function (err) {
		// release database connection
		con.end();
		
		if (err) {
		    callback ({
			"status": "failed",
    			"message": "problem updating database: " + err.code
		    });
		    return;
		}
		
		callback ({
		    "status": "name-mismatch",
    		    "message": "patient name does not match participant name"
		});

		// Email tickets
		let transporter = nodemailer.createTransport({
		    host: "localhost",
		    port: 25,
		    secure: false,
		    ignoreTLS: true
		});
		const messageText =
		      "A SMART Health Card was verified, but the patient name did not match\n" + 
                      "the full name in the ticketing database.  Please manually review and\n" +
		      "decide if the names below identify the same person.\n\n" +
		      "If the names identify the same person, manually update the record for\n" +
		      "the user number in the covidauth table, setting 'status' to 'verified',\n" +
		      "and email the user letting them know their card was verified. Additionally,\n" +
		      "set 'type' to 'vaccination' if it is not already the case.\n\n" +
		      "If the names do not identify the same person, email the user letting them\n" +
		      "know their card could not be verified.\n\n" +
		      `Ticketing uid:              ${uid}\n` +
		      `Name on card:               ${patientName}\n` +
		      `Name in ticketing database: ${results[0].fullname}\n\n` +
		      "Thanks,\n   SMART Health Card Verifier\n";
		transporter.sendMail(
		    { from: '"SMART Health Card Verifier" <tech@fireflyartscollective.org>',
		      to: "tickets@fireflyartscollective.org",
		      subject: `Name mismatch in Health Card Verification - ${uid}, ${patientName}, ${results[0].fullname}`,
		      text: messageText
		    },
		    (err, info) => {
			if (err) {
			    console.log(err);
			    return;
			}
		    });
		return;
	    });
	});
    });    
}

http.createServer(async function (req, response) {
    // Read the request
    const buffers = [];
    for await (const chunk of req) {
	buffers.push(chunk);
    }
    const data = Buffer.concat(buffers).toString();
    var qrdata;
    try {
	qrdata = JSON.parse(data).qrdata;
    } catch {
	response.writeHead(200, {'Content-Type': 'application/json'});
	response.end(JSON.stringify({"status": "failed",
    				     "message": "bad request"
				    }))
	return;
    }

    // download daily VCI directory snapshot by default.
    // TODO: We probably don't need to do this once per request

    // The nightly snapshot on 2022-06-07 was corrupt and broke
    // everything, so I don't trust it anymore and am pinning
    // 2022-06-06 for now.
    //    const vciDirectory = await Directory.create('vci');
    const vciDirectory = await Directory.create('https://raw.githubusercontent.com/the-commons-project/vci-directory/2377780c1b2e64ccbf659f9e446635e526a5e961/logs/vci_snapshot.json');
    
    // Decode and Verify the SMART Health Card signatures
    const result = await verify(qrdata, vciDirectory);
    processCard(JSON.parse(data).uid, result, (resJson) => {
	// Send the response
	response.writeHead(200, {'Content-Type': 'application/json'});
	response.end(JSON.stringify(resJson));
    });
    
}).listen(8080);

console.log('Server running at http://127.0.0.1:8080/');

// Other TODO items:
// - refactor processCard into multiple functions

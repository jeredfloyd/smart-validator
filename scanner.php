<!-- NOTE: This is a page fragment; I am checking it in for future
reference and a warning (or aid) to others.  This page is designed to
be included in an enclosing DIV, and have $this->user['id'] set to
something appropriate for the back-end server. -->
    
<h4>If you have a <a
href="https://smarthealth.cards/en/faq.html#How-can-I-get-a-COVID-19-SMART-Health-Card">
SMART Health Card</a> (COVID-19 Digital Vaccination Card), you can
<b>save yourself and Gate volunteers time</b> by verifying your QR
code online! If you were vaccinated in Massachusetts you
can <a href="https://www.mass.gov/massachusetts-vaccination-records">
retrieve your card from the state website</a>, or you may already have
this card in the app from your doctor or
pharmacy. (<a href="https://smarthealth.cards/en/issuers.html">Here
are links to more state and health care issuers.</a>)</h4>

<p>This page is for <b>digital vaccination cards only</b>; printed or
written records must be verified at Gate.</p>

<p>We do not store any information except confirmation of a
successful validation, and the name on your card if it does not match
your Firefly registration (so we can manually review).</p>

<div id="scanners">
    <h4>If you have your QR code in a file, you can upload it here:</h4>
    <input type="file" id="file-selector">

    <div id="videoscan">
        <h4>Or you can scan your QR code below:</h4>
        <p>This page will automatically refresh when the code is recognized.</p>
        <div id="video-container">
            <video id="qr-video"></video>
        </div>
    </div>
    <div id="videonoscan" style="display: none">
        <h4>You can also visit this page from a device with a camera to scan directly.</h4>
    </div>
</div>

<div id="processing" style="display: none">
   <h1>Processing your QR Code...</h1>
   <p>(If you don't see a response shortly the server may be unavailable)</p>
</div>

<div id="failed" style="display: none">
    <h1>Unable to Verify</h1>

    <p>Unfortunately we were unable to verify this SMART Health Card
    because <span id="reason">an unknown error occured</span>.</p>

    <p>Please bring your vaccination records to be verified at Gate;
    you will not be admitted to the event without meeting our <a
    target="_blank"
    href="https://www.fireflyartscollective.org/firefly-arts-collective/firefly-policies/#covid">
    event COVID-19 safety requirements</a>.</p>

    <p>If you believe your card is valid, please mail <a
    href="mailto:tech@fireflyartscollective.org">tech@fireflyartscollective.org</a>
    so we can enhance this page.</p>
</div>

<div id="mismatch" style="display: none">
    <h1>Unable to Verify - Name Mismatch</h1>

    <p>This looks like a valid immunization record, but the patient
    name didn't match the name we have on file for you. This is likely
    as simple as a nickname, middle name, or accent character -- our
    computers aren't that smart!</p>

    <p>Someone from Ticket Core will take a look and try to match the
    patient name to your name and let you know if you're good.</p>
    
    <p>Until you hear back, please bring your vaccination records to
    be verified at Gate; you will not be admitted to the event without
    meeting our <a target="_blank"
    href="https://www.fireflyartscollective.org/firefly-arts-collective/firefly-policies/#covid">
    event COVID-19 safety requirements</a>.</p>
</div>

<div id="success" style="display: none">
    <h1>Verification Successful!</h1>

    <p>Thank you for verifying your immunization status in advance!
    We've recorded that you meet the event COVID-19 safety
    requirements, and you won't need to verify your vaccination status
    at Gate.  See you in the woods! </p>
</div>

<! --A PDF renderer, because why not -->
<script src="//mozilla.github.io/pdf.js/build/pdf.js"></script>
       
<script type="module">
    import QrScanner from "./qr-scanner.min.js";

    const video = document.getElementById('qr-video');
    const videoContainer = document.getElementById('video-container');
    const fileSelector = document.getElementById('file-selector');

    function tryFileScan(file, iteration) {
        QrScanner.scanImage(file, { returnDetailedScanResult: true })
            .then(result => setResult(result))
            .catch(e => {
                switch (iteration) {
                case 1:
                    // Couldn't scan this file as-is; it's probablty a mangled MIIS code
                    // (or maybe someone giving us garbage...)
                    // Let's try to pull this into an Image so we can manipulate it
                    var image = new Image();
                    var reader = new FileReader();
                    reader.onload = function(event) {
                        image.src = event.target.result;
                    }
                    image.onload = function(event) {
                        // Resize (I assume this is a 400x740 MIIS image; let's go to 500px)
                        var factor = 500 / image.width;
                        var canvas = document.createElement("canvas");
                        var ctx = canvas.getContext("2d");
                        canvas.width = image.width * factor;
                        canvas.height = image.height * factor;
                        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                        
                        // Tail recursion, because we live in a continuation world
                        image.onload = function(event) {
                            tryFileScan(image, 2);
                        }
                        image.src = canvas.toDataURL();
                    }
                    image.onerror = function (event) {
                        // This isn't an image.  Maybe it's a PDF?
                        tryFileScan(reader, 4);
                    }
                    reader.readAsDataURL(file);
                    break;
                    
                case 2:
                    // File is an image still
                    var image = file;
                    // Try 300px
                    var factor = 300 / image.width;
                    var canvas = document.createElement("canvas");
                    var ctx = canvas.getContext("2d");
                    canvas.width = image.width * factor;
                    canvas.height = image.height * factor;
                    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                    
                    // Tail recursion, because we live in a continuation world
                    image.onload = function(event) {
                        tryFileScan(image, 3);
                    }
                    image.src = canvas.toDataURL();
                    break;

                case 4:
                    // file is a FileReader() object that has already
                    // completed at this point, so FileReader.result
                    // is a dataURL
                    var pdfjsLib = window['pdfjs-dist/build/pdf'];
                    pdfjsLib.GlobalWorkerOptions.workerSrc = '//mozilla.github.io/pdf.js/build/pdf.worker.js';
                    var loadingTask = pdfjsLib.getDocument(file.result);
                    loadingTask.promise.then(function(pdf) {
                        // Fetch the first page
                        var pageNumber = 1;
                        pdf.getPage(pageNumber).then(function(page) {
                            var scale = 1.5;
                            var viewport = page.getViewport({scale: scale});
                            
                            // Prepare canvas using PDF page dimensions
                            var canvas = document.createElement("canvas");
                            var context = canvas.getContext('2d');
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;
                            
                            // Render PDF page into canvas context
                            var renderContext = {
                                canvasContext: context,
                                viewport: viewport
                            };
                            var renderTask = page.render(renderContext);
                            renderTask.promise.then(function () {
                                tryFileScan(canvas.toDataURL(), 5);
                            });
                        });
                    }, function (reason) {
                        // PDF loading error
                        console.error(reason);
                        document.getElementById('reason').textContent = 'we couldn\'t recognize this as an image file';
                        document.getElementById('processing').style.display = 'none';
                        document.getElementById('failed').style.display = 'block';
                    });
                    break;
        
                default:
                    // I give up; I'm not going to coerce a useful QR code out of this file
                    document.getElementById('reason').textContent = 'the file scanner said: ' + e;
                    document.getElementById('processing').style.display = 'none';
                    document.getElementById('failed').style.display = 'block';
                }
            });
    }

    function setResult(result) {
        // If this is shorter than 10 chars assume a spurious read
        if (result.data.length < 10) return;

        // Put up a 'progress' message
        scanner.stop();
        document.getElementById('scanners').style.display = 'none';
        document.getElementById('processing').style.display = 'block';

        // Generate request to validation endpoint
        var xhr = new XMLHttpRequest();
        const reqJson = {
           "uid": "<?php print($this->user['id']) ?>",
    	   "qrdata": result.data
	};

	xhr.onreadystatechange = function () {
            if (this.readyState != 4) return;
	    
            if (this.status != 200) {
	       document.getElementById('reason').textContent = 'the server returned an error';
	       document.getElementById('processing').style.display = 'none';
	       document.getElementById('failed').style.display = 'block';
      	       return;
	    }
	    
            var data = JSON.parse(this.responseText);
	    if (data.status === 'failed') {
	       document.getElementById('reason').textContent = data.message;
	       document.getElementById('processing').style.display = 'none';
	       document.getElementById('failed').style.display = 'block';
      	       return;
	    }
	    if (data.status === 'name-mismatch') {
	       document.getElementById('processing').style.display = 'none';
	       document.getElementById('mismatch').style.display = 'block';
      	       return;
	    }
	    if (data.status === 'success') {
	       document.getElementById('processing').style.display = 'none';
	       document.getElementById('success').style.display = 'block';
      	       return;
	    }
	    document.getElementById('reason').textContent = 'the server returned an unexpected result';
	    document.getElementById('processing').style.display = 'none';
	    document.getElementById('failed').style.display = 'block';
       };

       xhr.open("POST", "<?php print($this->config['html_prefix']) ?>" + "smart-validator");
       xhr.setRequestHeader('Content-Type', 'application/json');
       xhr.send(JSON.stringify(reqJson));
    }

    const scanner = new QrScanner(video, result => setResult(result), {
        // Use entire window as scan region
        calculateScanRegion: video => {
                return {
                    x: 0,
                    y: 0,
                    width: video.videoWidth,
                    height: video.videoHeight,
                    downScaledWidth: video.videoWidth,
                    downScaledHeight: video.videoHeight
                }
        },
    });

    scanner.start();

    QrScanner.hasCamera().then(hasCamera => {if (!hasCamera) {
	document.getElementById('videoscan').style.display = 'none';
	document.getElementById('videonoscan').style.display = 'block';
    }});

    fileSelector.addEventListener('change', event => {
        const file = fileSelector.files[0];
        if (!file) {
            return;
        }
        scanner.stop();
	document.getElementById('scanners').style.display = 'none';
	document.getElementById('processing').style.display = 'block';
	tryFileScan(file, 1);
    });
</script>

<style>
    #video-container {
        line-height: 0;
    }

    #qr-video {
	width: 80%;
    }

    hr {
        margin-top: 32px;
    }
    input[type="file"] {
        display: block;
        margin-bottom: 16px;
    }
</style>


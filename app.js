const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const libre = require('libreoffice-convert');
libre._libreOfficeBinaryPath = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
const { PDFDocument, degrees } = require('pdf-lib');
const archiver = require('archiver');
const glob = require('glob');
const cors = require('cors');

const app = express(); // ✅ define app first
const PORT = 3000;

// ✅ Then use app
app.use(cors({
  origin: 'https://file2do.com',
  methods: ['GET', 'POST'],
}));


// Ensure folders exist
['uploads', 'compressed'].forEach(folder => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/compressed', express.static('compressed'));

// Multer Setup
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    const uniqueName = Date.now() + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

/* ------------ IMAGE COMPRESSION ------------ */
app.post('/upload', upload.single('image'), async (req, res) => {
  const inputPath = req.file.path;
  const outputFilename = 'compressed_' + req.file.filename;
  const outputPath = path.join('compressed', outputFilename);
  const allowedTypes = ['image/jpeg', 'image/png'];

  if (!allowedTypes.includes(req.file.mimetype)) {
    fs.unlinkSync(inputPath);
    return res.status(400).send('Only JPG and PNG formats are allowed.');
  }

  const compression = parseInt(req.body.compression) || 60;
  const quality = Math.max(10, 100 - compression);

  try {
    const image = sharp(inputPath);
    if (req.file.mimetype === 'image/png') {
      await image.png({ quality }).toFile(outputPath);
    } else {
      await image.jpeg({ quality }).toFile(outputPath);
    }

    const compressedSize = fs.statSync(outputPath).size;
    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: compressedSize,
    });

    fs.unlinkSync(inputPath);
  } catch (err) {
    console.error('Image Compression Error:', err);
    res.status(500).send('Image compression failed.');
  }
});

/* ------------ VIDEO COMPRESSION ------------ */


app.post('/compress-pdf', upload.single('file'), async (req, res) => {
  const compression = parseInt(req.body.compression) || 60;
  const inputPath = req.file.path;
  const originalSize = fs.statSync(inputPath).size;

  // EXTREME compression when slider is at or above 90
  if (compression >= 90) {
    const outputDir = path.join('compressed', `temp_${Date.now()}`);
    const outputPdf = path.join('compressed', `extreme_${Date.now()}.pdf`);

    try {
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

      // Adjust DPI + quality to try hitting 90% compression
      const dpi = 50; // Low DPI
      const quality = 30; // Use mid-low JPEG quality 

      const cmd = `pdftoppm "${inputPath}" "${outputDir}/page" -jpeg -r ${dpi}`;
      console.log(`📄 Converting to JPGs @ ${dpi} DPI for extreme compression`);

      await new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
          if (err) return reject(stderr);
          resolve();
        });
      });

      const imageFiles = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      if (imageFiles.length === 0) throw new Error('❌ No JPGs generated from PDF.');

      const pdfDoc = await PDFDocument.create();

      for (const filename of imageFiles) {
        const imagePath = path.join(outputDir, filename);
        const imageBytes = fs.readFileSync(imagePath);
        const image = await pdfDoc.embedJpg(imageBytes);
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPdf, pdfBytes);

      // Cleanup
      fs.unlinkSync(inputPath);
      fs.rmSync(outputDir, { recursive: true, force: true });

      const finalSize = pdfBytes.length;
      const percent = Math.round((1 - finalSize / originalSize) * 100);

      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${path.basename(outputPdf)}`,
        originalSize,
        finalSize,
        compressionPercent: percent,
        method: 'extreme'
      });

    } catch (err) {
      console.error('❌ Extreme compression failed:', err);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true });
      return res.status(500).send('Extreme compression failed.');
    }

  } else {
    // STANDARD Ghostscript compression
    const outputFilename = `compressed_${Date.now()}.pdf`;
    const outputPath = path.join('compressed', outputFilename);

    let setting = '/ebook';
    if (compression >= 80) setting = '/screen';
    else if (compression >= 60) setting = '/ebook';
    else if (compression >= 40) setting = '/printer';
    else setting = '/prepress';

    const gsCmd = `gswin64c -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
-dDownsampleColorImages=true -dColorImageResolution=72 \
-dDownsampleGrayImages=true -dGrayImageResolution=72 \
-dDownsampleMonoImages=true -dMonoImageResolution=72 \
-dCompressFonts=true -dEmbedAllFonts=true -dSubsetFonts=true \
-dAutoRotatePages=/None -dPDFSETTINGS=${setting} -dNOPAUSE -dQUIET -dBATCH \
-sOutputFile="${outputPath}" "${inputPath}"`;

    console.log(`🧠 Ghostscript compression @${compression}% with setting ${setting}`);
    exec(gsCmd, (err, stdout, stderr) => {
      fs.unlinkSync(inputPath);
      if (err) {
        console.error('❌ Ghostscript error:', stderr);
        return res.status(500).send('PDF compression failed.');
      }

      const finalSize = fs.statSync(outputPath).size;
      const percent = Math.round((1 - finalSize / originalSize) * 100);

      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
        originalSize,
        finalSize,
        compressionPercent: percent,
        method: 'standard'
      });
    });
  }
});









/* ------------ CONVERT TO PDF ------------ */
app.post('/convert-to-pdf', upload.single('file'), (req, res) => {
  const inputPath = req.file.path;
  const outputFilename = path.basename(req.file.originalname, path.extname(req.file.originalname)) + '.pdf';
  const outputPath = path.join('compressed', outputFilename);

  const file = fs.readFileSync(inputPath);

  libre.convert(file, '.pdf', undefined, (err, done) => {
    if (err) {
      console.error('LibreOffice Convert Error:', err);
      fs.unlinkSync(inputPath);
      return res.status(500).send('File conversion failed.');
    }

    fs.writeFileSync(outputPath, done);
    const convertedSize = fs.statSync(outputPath).size;

    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: convertedSize
    });

    fs.unlinkSync(inputPath);
  });
});

/* ------------ IMAGE TO PDF ------------ */
app.post('/image-to-pdf', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputFilename = `converted_${Date.now()}.pdf`;
  const outputPath = path.join('compressed', outputFilename);

  const fileExt = path.extname(req.file.originalname).toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png'];

  if (!allowed.includes(fileExt)) {
    fs.unlinkSync(inputPath);
    return res.status(400).send('Only JPG, PNG, and JPEG files are allowed.');
  }

  try {
    const imageBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.create();

    const image = (fileExt === '.png')
      ? await pdfDoc.embedPng(imageBytes)
      : await pdfDoc.embedJpg(imageBytes);

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: pdfBytes.length
    });

    fs.unlinkSync(inputPath);
  } catch (err) {
    console.error('Image to PDF Error:', err);
    res.status(500).send('Image to PDF conversion failed.');
  }
});


/* ------------ MAKE PDF SEARCHABLE ------------ */
app.post('/make-searchable', upload.single('file'), (req, res) => {
  const inputPath = req.file.path;
  const outputFilename = `searchable_${Date.now()}.pdf`;
  const outputPath = path.join('compressed', outputFilename);

  const cmd = `ocrmypdf --force-ocr --output-type pdf "${inputPath}" "${outputPath}"`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('OCRmyPDF error:', stderr);
      fs.unlinkSync(inputPath);
      return res.status(500).send('Making searchable PDF failed.');
    }

    const newSize = fs.statSync(outputPath).size;
    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: newSize
    });

    fs.unlinkSync(inputPath);
  });
});



app.post('/merge-pdf', upload.array('files'), async (req, res) => {
  const files = req.files;
  if (!files || files.length < 2) {
    return res.status(400).send('Upload at least two PDF files.');
  }

  try {
    const mergedPdf = await PDFDocument.create();

    for (const file of files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
      fs.unlinkSync(file.path); // clean up
    }

    const mergedPdfBytes = await mergedPdf.save();
    const outputFilename = `merged_${Date.now()}.pdf`;
    const outputPath = path.join('compressed', outputFilename);

    fs.writeFileSync(outputPath, mergedPdfBytes);
    res.json({ downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}` });

  } catch (error) {
    console.error('Merge Error:', error);
    res.status(500).send('PDF merge failed.');
  }
});

/* ------------ PDF TO WORD ------------ */


app.post('/pdf-to-word', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.resolve('compressed');
  const timestamp = Date.now();

  const sofficeCmd = `"C:\\Program Files\\LibreOffice\\program\\soffice.exe" --headless --convert-to docx --outdir "${outputDir}" "${inputPath}"`;

  exec(sofficeCmd, async (err, stdout, stderr) => {
    fs.unlinkSync(inputPath); // cleanup

    if (err) {
      console.error('LibreOffice CLI Error:', stderr || err);
      return res.status(500).send('PDF to Word conversion failed.');
    }

    // Find the most recent .docx in the output folder
    glob(`${outputDir}/*.docx`, (globErr, files) => {
      if (globErr || !files.length) {
        console.error('DOCX not found:', globErr);
        return res.status(500).send('Conversion failed. Output file missing.');
      }

      const latestFile = files
        .map(f => ({ f, time: fs.statSync(f).mtime.getTime() }))
        .sort((a, b) => b.time - a.time)[0].f;

      const size = fs.statSync(latestFile).size;

      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${path.basename(latestFile)}`,
        size,
      });
    });
  });
});

/* ------------ PROTECT PDF WITH PASSWORD ------------ */
app.post('/protect-pdf', upload.single('file'), (req, res) => {
  const inputPath = req.file.path;
  const password = req.body.password;
  const outputFilename = `protected_${Date.now()}.pdf`;
  const outputPath = path.join('compressed', outputFilename);

  if (!password) {
    fs.unlinkSync(inputPath);
    return res.status(400).send('Password is required.');
  }

  const cmd = `qpdf --encrypt ${password} ${password} 256 -- "${inputPath}" "${outputPath}"`;

  exec(cmd, (err, stdout, stderr) => {
    fs.unlinkSync(inputPath); // Clean up the uploaded file

    if (err) {
      console.error('QPDF error:', stderr);
      return res.status(500).send('PDF protection failed.');
    }

    const size = fs.statSync(outputPath).size;
    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size,
    });
  });
});

/* ------------ ORGANIZE PDF PAGES ------------ */
app.post('/organize-pdf', upload.single('originalPdf'), async (req, res) => {
  const inputPath = req.file?.path;
  const outputFilename = `organized_${Date.now()}.pdf`;
  const outputPath = path.join('compressed', outputFilename);

  try {
    if (!inputPath || !req.body.actions) {
      return res.status(400).json({ error: 'Missing file or actions.' });
    }

    const actions = JSON.parse(req.body.actions); // [0, 2, 'blank', 1]
    const originalPdf = await PDFDocument.load(fs.readFileSync(inputPath));
    const newPdf = await PDFDocument.create();

    for (let action of actions) {
      if (action === 'blank') {
        const blankPage = newPdf.addPage();
        blankPage.drawText('');
      } else {
        const [copiedPage] = await newPdf.copyPages(originalPdf, [action]);
        newPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await newPdf.save();
    fs.writeFileSync(outputPath, pdfBytes);
    fs.unlinkSync(inputPath);

    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: pdfBytes.length
    });
  } catch (err) {
    console.error('Organize PDF Error:', err);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.status(500).json({ error: 'Failed to organize PDF.' });
  }
});

/* ------------ PDF TO JPG (ZIP) ------------ */
app.post('/pdf-to-jpg', upload.single('file'), (req, res) => {
  const inputPath = req.file.path;
  const outputDir = path.join('compressed', `jpgs_${Date.now()}`);
  const zipName = `converted_${Date.now()}.zip`;
  const zipPath = path.join('compressed', zipName);

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const cmd = `pdftoppm "${inputPath}" "${outputDir}/page" -jpeg`;

  exec(cmd, async (err, stdout, stderr) => {
    fs.unlinkSync(inputPath);

    if (err) {
      console.error('PDF to JPG Error:', stderr);
      return res.status(500).send('Conversion failed.');
    }

    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${zipName}`,
        size: fs.statSync(zipPath).size
      });
    });

    archive.on('error', err => {
      console.error('Zip Error:', err);
      res.status(500).send('Failed to zip images.');
    });

    archive.pipe(output);
    archive.directory(outputDir, false);
    archive.finalize();
  });
});


/ * ------------ ADD PAGE NUMBERS TO PDF ------------ */
app.post('/compresss-pdf', upload.single('file'), (req, res) => {
  const inputPath = path.resolve(req.file.path);
  const ext = path.extname(req.file.originalname).toLowerCase();

  if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(ext)) {
    const outputFilename = path.basename(req.file.originalname, ext) + '.pdf';
    const outputPath = path.resolve('compressed', outputFilename);
    const file = fs.readFileSync(inputPath);

    libre.convert(file, '.pdf', undefined, (err, done) => {
      fs.unlinkSync(inputPath);
      if (err) {
        console.error('LibreOffice Convert Error:', err);
        return res.status(500).send('File conversion failed.');
      }
      fs.writeFileSync(outputPath, done);
      const compressedSize = fs.statSync(outputPath).size;

      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
        size: compressedSize,
      });
    });

  } else {
    const outputFilename = `compressed_${Date.now()}.pdf`;
    const outputPath = path.resolve('compressed', outputFilename);
    const compression = parseInt(req.body.compression) || 60;

    let setting = '/ebook';
    if (compression >= 80) setting = '/screen';
    else if (compression >= 60) setting = '/ebook';
    else if (compression >= 40) setting = '/printer';
    else setting = '/prepress';

    // Escape paths for Windows and quote them
    const escapedInput = inputPath.replace(/\\/g, '\\\\');
    const escapedOutput = outputPath.replace(/\\/g, '\\\\');

    const gsCmd = `"C:\\Program Files\\gs\\gs10.05.1\\bin\\gswin64c.exe" -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 \
-dPDFSETTINGS=${setting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${escapedOutput}" "${escapedInput}"`;

    console.log('Ghostscript command:', gsCmd);

    exec(gsCmd, (err, stdout, stderr) => {
      fs.unlinkSync(inputPath);
      if (err) {
        console.error('Ghostscript error:', stderr || err);
        return res.status(500).send('PDF compression failed.');
      }

      const compressedSize = fs.statSync(outputPath).size;

      res.json({
        downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
        size: compressedSize
      });
    });
  }
});



/* ------------ ROTATE OR DELETE PDF PAGES ------------ */
/* ------------ ROTATE OR DELETE PDF PAGES ------------ */
app.post('/rotate-pdf', upload.single('originalPdf'), async (req, res) => {
  const inputPath = req.file?.path;
  const outputFilename = `rotated_${Date.now()}.pdf`;
  const outputPath = path.join('compressed', outputFilename);

  console.log("📥 File received:", inputPath);
  console.log("📨 Raw actions:", req.body.actions);

  try {
    if (!inputPath || !req.body.actions) {
      console.log("❌ Missing file or actions");
      return res.status(400).json({ error: 'Missing file or actions.' });
    }

    const actions = typeof req.body.actions === 'string' 
      ? JSON.parse(req.body.actions)
      : req.body.actions;

    console.log("✅ Parsed actions:", actions);

    const originalPdf = await PDFDocument.load(fs.readFileSync(inputPath));
    const newPdf = await PDFDocument.create();

    for (const { originalIndex, rotation } of actions) {
      console.log(`➡️ Copying page ${originalIndex}, rotation: ${rotation}`);

      if (originalIndex >= originalPdf.getPageCount()) {
        console.log("⚠️ Invalid index:", originalIndex);
        continue;
      }

      // ✅ Correct destination.copyPages(source, [index])
      const [copiedPage] = await newPdf.copyPages(originalPdf, [originalIndex]);

      const angle = (rotation % 360 + 360) % 360;
      if (angle !== 0) {
        copiedPage.setRotation(degrees(angle));
      }

      newPdf.addPage(copiedPage);
    }

    const pdfBytes = await newPdf.save();

    if (!pdfBytes || pdfBytes.length === 0) {
      throw new Error("❌ PDF save failed, empty buffer.");
    }

    fs.writeFileSync(outputPath, pdfBytes);
    fs.unlinkSync(inputPath);

    console.log("✅ PDF created:", outputPath);

    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      size: pdfBytes.length
    });

  } catch (err) {
    console.error("❌ Rotate PDF Error:", err);
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.status(500).json({ error: 'Failed to rotate PDF.' });
  }
});




/* ------------ VIDEO COMPRESSION ------------ */
app.post('/compress-video', upload.single('file'), async (req, res) => {
  const inputPath = req.file.path;
  const outputFilename = `compressed_${Date.now()}.mp4`;
  const outputPath = path.join('compressed', outputFilename);

  const crf = parseInt(req.body.crf) || 28;
  const preset = 'medium';

  const ffmpegCmd = `ffmpeg -y -i "${inputPath}" -vcodec libx264 -preset ${preset} -crf ${crf} -acodec copy "${outputPath}"`;

  console.log(`🎬 Running: ${ffmpegCmd}`);

  exec(ffmpegCmd, (err, stdout, stderr) => {
    if (err) {
      console.error('❌ FFmpeg stderr:', stderr);
      return res.status(500).send('Video compression failed.');
    }

    fs.unlinkSync(inputPath); // Safe to delete now

    const finalSize = fs.statSync(outputPath).size;
    res.json({
      downloadUrl: `https://file2do-backend.onrender.com/compressed/${outputFilename}`,
      finalSize
    });
  });
});












/* ------------ START SERVER ------------ */
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

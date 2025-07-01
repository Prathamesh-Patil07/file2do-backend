# Use a Debian-based Node.js image
FROM node:18-slim

# Install system tools
RUN apt-get update && apt-get install -y \
    libreoffice \
    ghostscript \
    poppler-utils \
    qpdf \
    ffmpeg \
    ocrmypdf \
    tesseract-ocr \
    fonts-dejavu \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all project files
COPY . .

# Install Node dependencies
RUN npm install

# Create necessary folders (Render containers are ephemeral)
RUN mkdir -p uploads compressed

# Expose the port used by your app
EXPOSE 3000

# Start the Node.js app
CMD ["node", "app.js"]

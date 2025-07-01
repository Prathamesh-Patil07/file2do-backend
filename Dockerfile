# Use a slim Debian-based Node.js image
FROM node:18-slim

# Set non-interactive mode for apt
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libreoffice \
    ghostscript \
    poppler-utils \
    qpdf \
    ffmpeg \
    ocrmypdf \
    tesseract-ocr \
    fonts-dejavu \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files separately for efficient caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create required runtime directories (for temp file handling)
RUN mkdir -p uploads compressed

# Expose the port the app runs on
EXPOSE 3000

# Start your app
CMD ["node", "app.js"]

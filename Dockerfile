# Use an official, slim Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container to /app
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker layer caching
COPY package*.json ./

# Install app dependencies, but only for production
RUN npm install --only=production

# Copy the rest of the application's source code from your primordia directory to /app in the container
COPY . .

# Your app binds to port 8080, so expose it
EXPOSE 8080

# Define the command to run your app
CMD ["node", "index.js"]

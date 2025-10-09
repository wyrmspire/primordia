# Use an official, slim Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container to /app
WORKDIR /app

# Copy all files from the build context, including the pre-installed node_modules
# This assumes `npm install` was run in the build step before this Dockerfile is used.
COPY . .

# Your app binds to port 8080, so expose it
EXPOSE 8080

# Define the command to run your app
CMD ["node", "index.js"]

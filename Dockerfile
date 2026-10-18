FROM node:20-alpine

# Ustawienie katalogu roboczego w kontenerze
WORKDIR /app

# Kopiowanie plików zależności
COPY package*.json ./

# Instalacja pakietów Produkcyjnych
RUN npm install --production

# Kopiowanie pozostałych plików projektu
COPY . .

# Tworzenie bezpiecznego folderu na dane (dla Directory Mount w Colify)
RUN mkdir -p /app/data

# Otwarcie portu serwera HTTP (np. dla keep-alive)
EXPOSE 3000

# Uruchomienie bota
CMD ["node", "index.js"]

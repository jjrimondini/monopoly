# Pixel Empire

Gioco di compravendita di proprietà a tema videogiochi. Il PC fa da tabellone, i telefoni da controller.

## Avvio
```
npm install
npm start
```
1. Apri sul PC `http://localhost:3000/board/` (meglio a schermo intero).
2. I giocatori (2–6) inquadrano il QR code con il telefono, connesso alla **stessa rete Wi-Fi** del PC.
3. Premi **Avvia partita** sul tabellone (o dal telefono del primo giocatore).

Se i telefoni non si collegano:
- consenti Node.js nel Firewall di Windows per le reti private;
- se il PC ha più reti (VPN ecc.) forza l'IP giusto: `$env:HOST_IP="192.168.x.x"; npm start`.

Se un telefono si ricarica o perde la connessione, rientra automaticamente come lo stesso giocatore.

## Test
```
npm test
```

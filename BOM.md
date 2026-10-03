# VW T6 Digital Twin — Stückliste (BOM)

Fahrzeug: VW T6 Transporter/Caravelle, Bj. 2017

## Fahrzeug-Seite (Pi Blackbox)

| # | Bauteil | Spezifikation | Anz. | Anmerkung |
|---|---------|---------------|------|-----------|
| 1 | Raspberry Pi Zero 2 W | 512MB RAM, WiFi on board | 1 | Hauptrechner, ~5V/0.5A |
| 2 | microSD-Karte | 32 GB, High Endurance (SanDisk Max Endurance o.ä.) | 1 | wichtig für Schreibzyklen |
| 3 | GPS HAT | u-blox basiert, UART (z. B. Waveshare L76X GPS HAT) | 1 | Antenne an Frontscheibe |
| 4 | ELM327 Bluetooth | OBD-II Adapter, BT-Variante (z. B. Vgate iCar Pro) | 1 | später auf USB-Variante upgraden |
| 5 | DC-DC Wandler | 12V→5V, ≥3A, mit Enable-Pin (LM2596-Modul o.ä.) | 1 | versorgt Pi aus Bordbatterie |
| 6 | Spannungsteiler | 2 Widerstände (z. B. 100k/22k) → GPIO ADC via ADS1115 | 1 | Batteriespannung messen |
| 7 | ADS1115 | I2C ADC, 16-bit | 1 | Pi hat keinen ADC on-board |
| 8 | Unterspannungs-Schutzrelais | Kemo M148 o.ä., Cutoff ~12.0V | 1 | Falls GPIO-Logik versagt |
| 9 | KFZ-Kabel + Sicherung | 1,5mm², Flachsicherung 5A | 3m | Anschluss an Zweitbatterie |
| 10 | Gehäuse | IP40, ~100×70×30mm, mit Entlüftung | 1 | |

## Home-Seite (bereits vorhanden)

| # | Bauteil | Anmerkung |
|---|---------|-----------|
| 11 | Intel NUC mit Proxmox | ✅ vorhanden — neue LXC-CT `twin-server` (Debian 12, 1 vCPU, 512MB RAM, 8GB Disk) |
| 12 | Tailscale | ✅ läuft bereits |
| 13 | TrueNAS | ✅ vorhanden — optional für DB-Backups |

## Verbrauchsmaterial

Schraubklemmen, Schrumpfschlauch, Kabelbinder, Klett für Unter-Dash-Montage.

## Geschätzte Kosten (Fahrzeug-Seite)

ca. **90–110 €** (Pi ~25€, GPS HAT ~12€, ELM327 ~15€, Rest Kleinmaterial)

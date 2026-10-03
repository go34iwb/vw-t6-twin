#!/usr/bin/env python3
"""
Power watchdog: reads leisure battery voltage via ADS1115 on I2C.
Initiates a graceful shutdown when voltage stays below LOW_VOLTAGE_V
for LOW_HOLD_S seconds. Hardware relay (12.0V) is the last-resort cutoff.
"""
import os
import time
import logging
import subprocess

try:
    import board, busio
    import adafruit_ads1x15.ads1115 as ADS
    from adafruit_ads1x15.analog_in import AnalogIn
except Exception:
    board = None

DIVIDER_RATIO = float(os.environ.get("TWIN_DIVIDER", "5.545"))  # (100k+22k)/22k
LOW_VOLTAGE_V = float(os.environ.get("TWIN_LOW_V", "12.0"))
LOW_HOLD_S = float(os.environ.get("TWIN_LOW_HOLD", "30"))
CHECK_S = 5.0

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("power_watch")


def read_voltage():
    if board is None:
        return None
    i2c = busio.I2C(board.SCL, board.SDA)
    ads = ADS.ADS1115(i2c)
    chan = AnalogIn(ads, ADS.P0)
    return chan.voltage * DIVIDER_RATIO


def main():
    low_since = None
    while True:
        v = read_voltage()
        if v is None:
            log.warning("ADS1115 unavailable, idle")
            time.sleep(CHECK_S)
            continue
        log.debug("battery %.2fV", v)
        if v < LOW_VOLTAGE_V:
            if low_since is None:
                low_since = time.time()
                log.warning("voltage %.2fV below %.2fV, will shutdown in %.0fs",
                            v, LOW_VOLTAGE_V, LOW_HOLD_S)
            elif time.time() - low_since >= LOW_HOLD_S:
                log.error("voltage persisted low — shutting down")
                subprocess.run(["/sbin/shutdown", "-h", "now"])
                return
        else:
            if low_since is not None:
                log.info("voltage recovered %.2fV", v)
            low_since = None
        time.sleep(CHECK_S)


if __name__ == "__main__":
    main()

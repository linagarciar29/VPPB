/*
  VOEG · Ejemplo de salida serial para el sensor de ángulos.
  >>> Reemplaza leerAngulos() con TU código (MPU6050, BNO055, etc.) <<<

  Protocolo que entiende la app (115200 baudios, una línea por muestra):
      millis,yaw,pitch,roll\n      ej. 15320,12.50,-3.20,0.80
  (también acepta solo "yaw,pitch,roll")
  La app envía "START\n" al iniciar y "STOP\n" al finalizar: aquí se reinicia
  el reloj para que el tiempo del Arduino quede alineado con el t0 común.
*/
unsigned long t0 = 0;
bool grabando = false;

void leerAngulos(float &yaw, float &pitch, float &roll) {
  // TODO: pega aquí la lectura de tu sensor
  float t = millis() / 1000.0;
  yaw = 30 * sin(t * 0.5); pitch = -20 * sin(t * 0.3); roll = 5 * sin(t);
}

void setup() { Serial.begin(115200); }

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n'); cmd.trim();
    if (cmd == "START") { t0 = millis(); grabando = true; }
    if (cmd == "STOP")  { grabando = false; }
  }
  float y, p, r; leerAngulos(y, p, r);
  Serial.print(millis() - t0); Serial.print(',');
  Serial.print(y, 2); Serial.print(','); Serial.print(p, 2); Serial.print(','); Serial.println(r, 2);
  delay(10); // ~100 Hz
}

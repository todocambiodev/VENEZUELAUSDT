const { time, timeStamp } = require('node:console');
const { chromium } = require('playwright');

// Estructura de datos global
const anuncios = {
    usd: { buy: [], sell: [] },
    cop: { buy: [], sell: [] },
    ves: { buy: [], sell: [] }
};

let activarMonitor = true;
const ti = new Date().getTime()

/**
 * Función para monitorear anuncios P2P en Binance
 */
async function anunciosP2P(fiat = "COP", tipo = "SELL", metodos = [], monto = "", verificados = false, debug = false) {

	// Ciclo de inicialización
	while (activarMonitor) {
			let browser;
			try {
					// Inicia navegador
					browser = await chromium.launch({ headless: !debug });
					const context = await browser.newContext();
					const page = await context.newPage();

					// Abre la página según el tipo
					const url = tipo.toUpperCase() === "SELL" 
							? `https://p2p.binance.com/trade/sell/USDT?fiat=${fiat.toUpperCase()}&payment=all-payments`
							: `https://p2p.binance.com/trade/all-payments/USDT?fiat=${fiat.toUpperCase()}`;
					
					await page.goto(url, { waitUntil: 'load' });

					// Aceptar cookies
					try {
							await page.click("#onetrust-accept-btn-handler", { timeout: 5000 });
					} catch (e) { /* Si no aparece, ignorar */ }

					// Desactivar anunciantes verificados
					if (!verificados) {
							await page.click('button[aria-label="more filter"]');
							// Usamos locator con parent (..) igual que en Python
							const divPadre = page.getByText("Verified Merchant Ads only", { exact: true }).locator("..").locator("..").locator("..");
							await divPadre.locator('div[role="switch"][aria-checked="true"]').click();
							await page.click("button:has-text('Apply')");
					}

					// Seleccionar los métodos de pago
					await page.click("div[aria-label='All payment methods']");
					for (const metodo of metodos) {
							await page.locator(`div[role="option"][title="${metodo}"]`).click();
					}

					// Colocar el monto
					if (monto !== "") {
							await page.fill("#C2Csearchamount_searchbox_amount", monto);
							await page.waitForTimeout(999);
					}

					console.log(`\nMonitoreando cambios en los anuncios ${fiat}-${tipo}...`);
					let estadoInicial = [];

					// Ciclo de actualización de los anuncios
					while (activarMonitor) {
							try {
									const filas = page.locator("tr");
									const estadoActual = await filas.allInnerTexts();

									// Comparar arreglos de texto
									if (JSON.stringify(estadoActual) !== JSON.stringify(estadoInicial)) {
											estadoInicial = estadoActual;

											if (debug) {
													console.log(`\n⚠️ Cambio detectado en los anuncios ${fiat}-${tipo}! - (${new Date().toLocaleString()})`);
											}

											const anunciosLista = [];
											for (const texto of estadoActual) {
													const lineas = texto.split('\n');

													// Lógica de filtrado original de Python
													if (lineas[1]?.length === 1 && !texto.includes("Advertisers") && !texto.includes("Promoted")) {
															const nickname = lineas[2];
															const precio = lineas[9].replace(/,/g, "");
															const minimo = lineas[12].split(" ")[0].replace(/,/g, "");
															const maximo = lineas[14].split(" ")[0].replace(/,/g, "");
															const disponible = lineas[11];
															
															const bancos = [];
															for (let i = 15; i < lineas.length; i++) {
																	if (lineas[i] !== "\t" && !lineas[i].includes("USDT")) {
																			bancos.push(lineas[i]);
																	}
															}

															const anuncio = {
																	nickName: nickname,
																	precio: precio,
																	minimo: minimo,
																	maximo: maximo,
																	disponible: disponible,
																	bancos: bancos
															};
															anunciosLista.push(anuncio);
													}
											}

											anuncios[fiat.toLowerCase()][tipo.toLowerCase()] = anunciosLista;
											//console.log(JSON.stringify(anunciosLista[1], null, 2));

											if (debug) {
													console.log(JSON.stringify(anuncios, null, 2));
											}
									}

									await page.waitForTimeout(999);

							} catch (e) {
									if (debug) {
											console.error("ERROR EN EL CICLO DE ACTUALIZACION:", e);
									}
									if (page.isClosed()) {
											console.log("\nREINICIANDO...");
											break; 
									} else {
											await page.waitForTimeout(1800);
									}
							}
					}
			} catch (e) {
					if (debug) console.error("ERROR EN EL CICLO:", e);
					if (browser) await browser.close();
					await new Promise(res => setTimeout(res, 3600)); // Esperar antes de reintentar
			}
	}
}

/**
 * Envía los datos capturados a Google Apps Script
 * @param {string} url - La URL de ejecución del script de Google.
 */
async function enviarDatos(url) {
    let anuncioVesBuy = { precio: "" };
    let anuncioVesSell = { precio: "" };

    while (activarMonitor) {
        try {
            // Espera de ~100ms
            await new Promise(res => setTimeout(res, 100));

            // Helper para procesar y enviar cada tipo de anuncio
            const procesarAnuncio = async (fiat, tipo, cache) => {
                const lista = anuncios[fiat][tipo];
                // Verificamos que existan al menos 2 anuncios (índice 1) como en tu código original
                if (lista.length > 1 && cache.precio !== lista[1].precio) {
                    
                    const nuevoAnuncio = { ...lista[1] };
                    
                    if (tipo.toUpperCase() === "BUY") {
                        nuevoAnuncio.tipo = "COMPRA";
                    }
                    if (tipo.toUpperCase() === "SELL") {
                        nuevoAnuncio.tipo = "VENTA";
                    }
                    
                    console.log(`Enviando anuncio de ${tipo.toUpperCase()} - (${new Date()}):\n ${JSON.stringify(nuevoAnuncio)}`);

                    // Construir Query Params para el GET
                    const params = new URLSearchParams(nuevoAnuncio).toString();
                    const fullUrl = `${url}?${params}`;

                    const response = await fetch(fullUrl);
                    const resultado = await response.text();
                    console.log(`Respuesta GAS: ${resultado}`);
                    
                    return nuevoAnuncio; // Retornamos para actualizar el cache
                }
                return cache;
            };

            // Ejecutar las comprobaciones para cada moneda y tipo
            anuncioVesBuy = await procesarAnuncio('ves', 'buy', anuncioVesBuy);
            anuncioVesSell = await procesarAnuncio('ves', 'sell', anuncioVesSell);

        } catch (e) {
            console.error(`ERROR EN enviarDatos() - ${e.message}`);
        }
    }
}

/**
 * Función principal que orquestra todas las ejecuciones paralelas
 */
async function main() {
    try {
        const url = "https://script.google.com/macros/s/AKfycbw8TploovIoOwLEcREkLFI3qfNOASf77F17jb5eX4-AnpQCmmvVJ_j8HsozudUE3z285w/exec";
        const verificados = true;
        const montoVes = "5994";
        const montoCop = "37992";
        const montoUsd = "36";
        const debug = false;

        console.log("Iniciando monitoreo paralelo...");

        // Promise.all es el equivalente a asyncio.gather
        await Promise.all([
            anunciosP2P("ves", "buy", ["Pago Movil"], montoVes, verificados, debug),
            anunciosP2P("ves", "sell", ["Pago Movil"], montoVes, verificados, debug),
            enviarDatos(url)
        ]);
        
    } catch (e) {
        console.error(`ERROR EN main() - ${e.message}`);
    }
}

// Punto de entrada
main();

// Punto de salida
const minutos = 63;
setTimeout(() => {
	activarMonitor = false;
	console.log("CULMINANDO PROCESO...");
	process.exit(0);
}, 1000*60*minutos)
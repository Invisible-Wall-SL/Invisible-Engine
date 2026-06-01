"""Build the client-facing Italian status summary PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem,
    Table, TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT

OUTPUT = "Riassunto_Stato_Lavoro.pdf"

ACCENT = HexColor("#1f3a5f")
MUTED = HexColor("#555555")
RULE = HexColor("#cfd6e0")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "TitleIT", parent=styles["Title"],
    fontName="Helvetica-Bold", fontSize=22, leading=26,
    textColor=ACCENT, alignment=TA_LEFT, spaceAfter=4,
)
subtitle_style = ParagraphStyle(
    "Subtitle", parent=styles["Normal"],
    fontName="Helvetica", fontSize=10, leading=13,
    textColor=MUTED, spaceAfter=18,
)
h2_style = ParagraphStyle(
    "H2IT", parent=styles["Heading2"],
    fontName="Helvetica-Bold", fontSize=13, leading=16,
    textColor=ACCENT, spaceBefore=14, spaceAfter=6,
)
body_style = ParagraphStyle(
    "BodyIT", parent=styles["BodyText"],
    fontName="Helvetica", fontSize=10.5, leading=14.5,
    textColor=black, spaceAfter=6,
)
bullet_style = ParagraphStyle(
    "BulletIT", parent=body_style,
    leftIndent=14, bulletIndent=2, spaceAfter=3,
)


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, bullet_style), leftIndent=14, bulletColor=ACCENT) for t in items],
        bulletType="bullet", start="•", leftIndent=10, bulletFontSize=10,
    )


def numbered(items):
    return ListFlowable(
        [ListItem(Paragraph(t, bullet_style), leftIndent=18) for t in items],
        bulletType="1", start="1", leftIndent=14, bulletFontSize=10,
    )


def section(title, flowables):
    block = [Paragraph(title, h2_style)] + flowables
    return KeepTogether(block)


story = []

story.append(Paragraph("Riassunto del lavoro — stato attuale", title_style))
story.append(Paragraph("Progetto Invisible Engine · adattamento Stake Engine ↔ Play4Fun", subtitle_style))

story.append(section("Cosa ho costruito finora", [
    bullets([
        "Un <b>traduttore</b> (<font face='Courier'>packages/rgs-translator-eagaming</font>) che fa da ponte tra il protocollo Play4Fun (usato da EAGaming / Hot Fruits) e quello atteso dallo Stake Engine.",
        "Un <b>mock server</b> locale (<font face='Courier'>scripts/mock-rgs-server.mjs</font>) che imita Play4Fun, così posso sviluppare e testare senza dipendere dal server reale.",
        "Un <b>facade</b> che espone l'intero sistema nella forma che lo Stake Engine già conosce (stessi nomi di funzioni, stessa shape dei dati).",
        "L'app <font face='Courier'>lines</font> punta al facade tramite alias Vite — nessuna modifica all'engine originale.",
    ]),
]))

story.append(section("Cosa ho scoperto sul protocollo Play4Fun", [
    bullets([
        "Endpoint unico <font face='Courier'>/rgs/engine</font> con azioni <font face='Courier'>bet</font>, <font face='Courier'>play</font>, <font face='Courier'>collect</font>.",
        "Eventi osservati: <font face='Courier'>bet</font>, <font face='Courier'>gameStart</font>, <font face='Courier'>spinStart</font>, <font face='Courier'>spinWin</font>, <font face='Courier'>playedSpin</font>, <font face='Courier'>gameEnd</font>, <font face='Courier'>gameRoundOver</font>.",
        "Simboli osservati: <font face='Courier'>PIC1–PIC7</font> + <font face='Courier'>SCAT</font> (mappati a <font face='Courier'>L1–L5</font>, <font face='Courier'>H1–H2</font>, <font face='Courier'>S</font> di Stake).",
        "<b>Importi: interi in centesimi</b> (100 = $1.00). Stake usa interi in milionesimi (1.000.000 = $1.00). Fattore di conversione: 10.000. Già gestito nel facade.",
        "Due modalità di round: manuale (<font face='Courier'>collect</font> separato) e auto-collect.",
    ]),
]))

story.append(section("Cosa funziona", [
    bullets([
        "Smoke test del mock: <b>OK</b>",
        "Smoke test del facade: <b>OK</b>",
        "Flusso completo <font face='Courier'>bet → play → collect</font> con saldo aggiornato correttamente: <b>OK</b>",
        "Phase 2 chiusa, tutto pushato su <font face='Courier'>origin/main</font>.",
    ]),
]))

story.append(section("Cosa so dello Stake Engine (architettura)", [
    bullets([
        "Monorepo Turborepo con <b>6 app di gioco</b> (<font face='Courier'>lines</font>, <font face='Courier'>cluster</font>, <font face='Courier'>scatter</font>, <font face='Courier'>ways</font>, <font face='Courier'>number-picker</font>, <font face='Courier'>price</font>) e ~30 pacchetti condivisi.",
        "Stack: <b>Svelte 5 + SvelteKit</b>, <b>PixiJS 8</b> per il rendering, <b>XState 5</b> per la macchina a stati del gioco, <b>pixi-svelte</b> come ponte dichiarativo interno.",
        "Ogni app è autosufficiente: stessa struttura ma config, simboli e regole indipendenti.",
        "Il protocollo di comunicazione con il server è isolato in <font face='Courier'>packages/rgs-requests</font> — è il punto in cui si innesta il mio facade senza toccare le app.",
    ]),
]))

story.append(section("Cosa ho scoperto oggi sui config file", [
    bullets([
        "Ogni gioco ha <b>un solo file</b> <font face='Courier'>apps/&lt;gioco&gt;/src/game/config.ts</font> che contiene tutto: simboli, paylines, paytable, layout dei rulli (basegame e freegame), modalità di scommessa, RTP, max win.",
        "Il file viene <b>importato staticamente</b> a build-time. Il server non manda mai un config: invia solo eventi che fanno riferimento a simboli/posizioni che il config dovrebbe già conoscere.",
        "I tipi TypeScript sono <b>derivati dal config</b> (<font face='Courier'>type SymbolName = keyof typeof config.symbols</font>): cambio il config e il sistema dei tipi si aggiorna automaticamente. Però questa protezione vale solo a compile-time — i dati che arrivano dal server la bypassano.",
        "<b>Sostituire un config è facile in teoria</b> (un solo file), ma le dimensioni della griglia sono ancora hard-coded in <font face='Courier'>constants.ts</font>. Per portare davvero un'app su un altro gioco serve toccare anche quel file.",
        "<b>Robustezza: zero tolleranza ai mismatch.</b> Se il server manda un simbolo che il config non conosce, o una posizione fuori dalla griglia, l'app <b>crasha rumorosamente</b> (TypeError sull'accesso all'array). Nessun fallback, nessun simbolo di default, nessun controllo dei limiti. Lo dico come constatazione tecnica, non come critica: è un trade-off ragionevole quando server e client sono dello stesso fornitore, ma diventa un punto critico quando si fa adattamento tra protocolli diversi come stiamo facendo noi.",
    ]),
]))

story.append(section("Aggiornamento — il config arriva dal server", [
    Paragraph(
        "Scoperta importante: Play4Fun <b>invia il proprio config come primo evento</b> "
        "della sessione (<font face='Courier'>event:'config'</font>). Non serve scrapare il bundle del client: "
        "il server stesso dichiara simboli, griglia, paylines e paytable.",
        body_style,
    ),
    bullets([
        "<b>Vocabolario simboli chiuso:</b> 8 voci (<font face='Courier'>PIC1–PIC7</font> + <font face='Courier'>SCAT</font>). Nessuna sorpresa possibile a runtime.",
        "<b>Niente wild</b> (<font face='Courier'>wildSymbols: []</font>) e niente freegame dichiarato.",
        "<b>Griglia 5×3</b> confermata (<font face='Courier'>window: {reels:5, rows:3}</font>).",
        "<b>5 paylines, non 20</b> — correzione rispetto a quanto avevamo stimato. I 5 pattern di Hot Fruits coincidono con i primi 5 pattern del config Stake <font face='Courier'>lines</font> (in ordine diverso).",
        "<b>Paytable invertita rispetto alla nostra mappatura iniziale:</b> <font face='Courier'>PIC1</font> è il simbolo che paga di più (5-of-a-kind = 5000), <font face='Courier'>PIC7</font> il meno pagante (paga persino 2-of-a-kind = 5). La mappa simboli del traduttore va corretta.",
        "<b>Verifica matematica:</b> uno spinWin reale catturato in passato (<font face='Courier'>PIC4 × 3 = pay 40</font> con <font face='Courier'>betPerLine 2</font>) coincide con la paytable (<font face='Courier'>PIC4 → 20 × 2 = 40</font>). Conversioni di scala corrette.",
    ]),
]))

story.append(section("Implicazioni e prossimi passi da discutere", [
    numbered([
        "<b>Difesa al confine del facade.</b> Ora che il server dichiara il config, il facade può costruire al boot un whitelist di simboli, un clamp della griglia e una paytable di confronto, validando ogni evento successivo contro questa fonte di verità. Niente più crash silenziosi su simbolo sconosciuto.",
        "<b>Cross-check Stake ↔ Play4Fun.</b> Al boot il facade può confrontare il config statico di Stake con quello del server e segnalare ogni mismatch (es. \"Stake si aspetta <font face='Courier'>W</font> ma Play4Fun non manda mai wild\").",
        "<b>Correzione mappa simboli.</b> Da rivedere insieme: allineare per <i>payout assoluto</i> (PIC1→H1) o per <i>rank simbolico</i>. Decisione di design.",
        "<b>Mismatch semantici residui</b> — quando Stake si aspetta campi che Play4Fun non invia. Tre strategie possibili: sintetizzare un default sensato, rendere il campo opzionale nell'engine, oppure fallire esplicitamente al confine. Da decidere caso per caso.",
    ]),
]))

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="Riassunto del lavoro - stato attuale",
    author="Invisible Engine",
)
doc.build(story)
print(f"wrote {OUTPUT}")

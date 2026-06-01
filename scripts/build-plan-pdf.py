"""Build the client-facing plan PDF: adapting Stake `lines` to behave like Hot Fruits."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem,
    Table, TableStyle, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT

OUTPUT = "Piano_Adattamento_HotFruits.pdf"

ACCENT = HexColor("#1f3a5f")
MUTED = HexColor("#555555")
ACCENT_BG = HexColor("#eaf0f7")
RULE = HexColor("#cfd6e0")
PHASE_BG = HexColor("#f4f6f9")

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
h3_style = ParagraphStyle(
    "H3IT", parent=styles["Heading3"],
    fontName="Helvetica-Bold", fontSize=11, leading=14,
    textColor=ACCENT, spaceBefore=8, spaceAfter=4,
)
body_style = ParagraphStyle(
    "BodyIT", parent=styles["BodyText"],
    fontName="Helvetica", fontSize=10.5, leading=14.5,
    textColor=black, spaceAfter=6,
)
small_style = ParagraphStyle(
    "Small", parent=body_style,
    fontSize=9.5, leading=12.5, textColor=MUTED,
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


def comparison_table(rows):
    # rows: list of [label, stake, hot_fruits]
    header = [Paragraph("<b>Aspetto</b>", body_style),
              Paragraph("<b>Stake <i>lines</i> (oggi)</b>", body_style),
              Paragraph("<b>Hot Fruits (target)</b>", body_style)]
    data = [header] + [[Paragraph(c, body_style) for c in r] for r in rows]
    t = Table(data, colWidths=[4.2 * cm, 5.6 * cm, 5.6 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, ACCENT),
        ("LINEBELOW", (0, 1), (-1, -2), 0.3, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def phase(num, title, why, items, touchpoints=None):
    label = Paragraph(f"<b>Fase {num} — {title}</b>", h3_style)
    blocks = [label, Paragraph(f"<i>Obiettivo:</i> {why}", body_style), bullets(items)]
    if touchpoints:
        blocks.append(Paragraph(f"<i>File toccati:</i> {touchpoints}", small_style))
    return KeepTogether(blocks)


story = []

# ---------------- Title ----------------
story.append(Paragraph("Piano di adattamento", title_style))
story.append(Paragraph("Stake <i>lines</i> → Hot Fruits · breakdown del lavoro · 2026-05-08", subtitle_style))

# ---------------- Goal ----------------
story.append(section("Obiettivo", [
    Paragraph(
        "Ridurre il gioco <font face='Courier'>lines</font> dello Stake Engine a una forma compatibile con i segnali "
        "che il server Play4Fun di Hot Fruits invia: meno paylines, niente wild, niente freegame, "
        "niente buy-bonus, paytable allineata. Il risultato è un'app <font face='Courier'>lines</font> che, alimentata "
        "dal traduttore, riproduce fedelmente il comportamento di Hot Fruits.",
        body_style,
    ),
]))

# ---------------- State comparison ----------------
story.append(section("Confronto stato attuale", [
    comparison_table([
        ["Griglia", "5 reel × 3 righe", "5 reel × 3 righe — <b>già allineato</b>"],
        ["Paylines", "20 pattern", "5 pattern (i primi 5 di Stake coincidono)"],
        ["Simboli", "9 (H1, H2, L1–L5, W, S)", "8 (PIC1–PIC7, SCAT) — niente W"],
        ["Wild", "Sì (simbolo W)", "<b>Assente</b>"],
        ["Bet modes", "<font face='Courier'>base</font> + <font face='Courier'>bonus</font> (buy-bonus)", "Solo <font face='Courier'>base</font>"],
        ["Freegame", "Struttura <font face='Courier'>paddingReels.freegame</font> presente", "Non dichiarato nel config server"],
        ["Paytable", "Formato <font face='Courier'>[{5:p}, {4:p}, {3:p}]</font>", "Formato <font face='Courier'>{occurs:[3,4,5], pay:[…]}</font>"],
        ["RTP", "0.97", "Da confermare lato server"],
        ["Sprite art", "Simboli generici Stake", "Si tengono quelli di Stake (deciso col cliente)"],
    ]),
]))

# ---------------- Phases ----------------
story.append(Paragraph("Fasi di lavoro", h2_style))

story.append(phase(
    1, "Allineamento del config Stake <font face='Courier'>lines</font>",
    "Portare il file di configurazione del gioco alla forma minima compatibile con Hot Fruits.",
    [
        "Ridurre le paylines da 20 a 5 (riusare i primi 5 pattern già presenti, eventualmente riordinati).",
        "Rimuovere il bet mode <font face='Courier'>bonus</font>; tenere solo <font face='Courier'>base</font>.",
        "Rimuovere il simbolo <font face='Courier'>W</font> dal dictionary <font face='Courier'>symbols</font>.",
        "Aggiornare la paytable dei 7 simboli line + 1 scatter ai valori dichiarati dal server.",
        "Decidere se rimuovere o lasciare strutturalmente vuoto <font face='Courier'>paddingReels.freegame</font>.",
    ],
    "<font face='Courier'>apps/lines/src/game/config.ts</font>",
))

story.append(phase(
    2, "Aggiornamento delle costanti di rendering",
    "Sincronizzare la mappa di sprite e dimensioni della board con il nuovo set di simboli.",
    [
        "Rimuovere <font face='Courier'>W</font> da <font face='Courier'>SYMBOL_INFO_MAP</font> (sprite, animazioni, font del valore).",
        "Verificare che <font face='Courier'>BOARD_DIMENSIONS</font> sia coerente (dovrebbe già esserlo: 5×3).",
        "Aggiornare gli import di asset se rimuoviamo le texture del wild.",
    ],
    "<font face='Courier'>apps/lines/src/game/constants.ts</font>",
))

story.append(phase(
    3, "Modulazione via config — <i>nessuna modifica all'engine</i>",
    "Sfruttare la modularità già presente in Stake Engine: la maggior parte delle feature si attiva o spegne in base al config e agli eventi che il server manda. Evitiamo qualunque chirurgia sull'engine, che romperebbe il funzionamento per altri giochi che usano wild, freegame e buy-bonus.",
    [
        "<b>Wild — niente da fare a livello engine.</b> Il codice del gioco non contiene alcun riferimento hardcoded al simbolo <font face='Courier'>W</font>: la wild è puramente dichiarata via <font face='Courier'>special_properties: ['wild']</font> nel config. Rimosso dal config, l'engine non lo cerca più.",
        "<b>Freegame — disattivata di fatto, struttura mantenuta.</b> Il path freegame parte solo all'arrivo dell'evento <font face='Courier'>freeSpinTrigger</font> dal server. Hot Fruits non lo invia, quindi non viene mai eseguito. <b>Importante:</b> manteniamo <font face='Courier'>paddingReels.freegame</font> nel config (anche con stack minimi) perché l'engine accede dinamicamente a <font face='Courier'>paddingReels[gameType]</font> e va in errore se la chiave manca. È una difesa, non una modifica.",
        "<b>Buy-bonus — piccola estensione additiva al config.</b> Il pulsante è renderizzato di default nei layout. Soluzione: aggiungere un flag opzionale <font face='Courier'>features.buyBonus: boolean</font> al config (default <font face='Courier'>true</font> per non rompere nulla). I layout leggono il flag e nascondono il bottone se <font face='Courier'>false</font>. È un'estensione backward-compatible, riusabile da qualunque futuro gioco senza buy-bonus.",
        "<b>Cross-check finale:</b> grep per riferimenti hardcoded a <font face='Courier'>'W'</font>, <font face='Courier'>'freegame'</font>, <font face='Courier'>'bonus'</font> per verificare che nessuna assunzione superi quanto già mappato.",
    ],
    "Solo <font face='Courier'>apps/lines/src/game/config.ts</font> + un piccolo flag nei layout — niente <font face='Courier'>actor.ts</font>, niente state machine, niente engine.",
))

story.append(phase(
    4, "Estensione del traduttore / facade",
    "Il facade diventa il punto in cui il config server-side viene catturato e validato contro quello statico di Stake.",
    [
        "Aggiungere il caso <font face='Courier'>event: 'config'</font> al union <font face='Courier'>Play4FunBookEvent</font> in <font face='Courier'>types.ts</font>.",
        "Implementare al boot del facade: cattura del primo <font face='Courier'>config</font>, costruzione di whitelist simboli, clamp griglia, mappa paytable di riferimento.",
        "Cross-check al boot: confronto fra config Stake e config Play4Fun, con warning per ogni divergenza.",
        "Correggere <font face='Courier'>linesMapping</font> nella forma corretta (PIC1→H1, …, PIC7→L5, SCAT→S).",
        "Convertire le 5 paylines Play4Fun nelle 5 paylines Stake corrispondenti, riconciliando l'ordine.",
        "Filtrare eventi/posizioni fuori griglia o con simboli sconosciuti, con log esplicito.",
    ],
    "<font face='Courier'>packages/rgs-translator-eagaming/src/{types,gameMappings,stakeFacade}.ts</font>",
))

story.append(phase(
    5, "Aggiornamento del mock e dei test",
    "Il mock locale deve riflettere il nuovo contratto, e i test di smoke vanno rifatti.",
    [
        "Far emettere al mock l'evento <font face='Courier'>config</font> come primo evento di sessione.",
        "Allineare la paytable del mock a quella reale di Hot Fruits.",
        "Smoke test end-to-end: <font face='Courier'>bet → play → collect</font> con verifica payout.",
        "Test di regressione: dato un <font face='Courier'>spinWin</font> noto, l'importo calcolato dall'engine combacia con quello del server.",
    ],
    "<font face='Courier'>scripts/mock-rgs-server.mjs, scripts/smoke-*.mjs</font>",
))

story.append(phase(
    6, "Punti aperti — da indagare prima/durante il lavoro",
    "Domande a cui non abbiamo ancora risposta certa: vanno chiuse durante una sessione di gioco prolungata.",
    [
        "<b>Free spins</b>: il config dichiarato non li menziona, ma in payload precedenti compariva <font face='Courier'>mpInfo</font> negli <font face='Courier'>spinWin</font>. Hot Fruits ha free spins triggerati dallo scatter? Da verificare con sessione lunga.",
        "<b>Multiplier</b>: il campo <font face='Courier'>mpInfo: {mp, replacements}</font> osservato nei <font face='Courier'>spinWin</font>. Quando si attiva e che effetto ha? Da capire.",
        "<b>Errori server</b>: il codice 110 (\"unexpected action\") è gestito; altri codici vanno catturati e mappati a comportamenti dell'engine.",
        "<b>RTP server</b>: confermare il valore reale per allineare l'<font face='Courier'>rtp</font> nel config Stake.",
        "<b>buyBonus</b>: assumiamo che Hot Fruits non lo abbia. Confermare con prove reali prima di rimuovere il bet mode.",
    ],
    None,
))

# ---------------- Effort ----------------
story.append(section("Stima a colpo d'occhio", [
    bullets([
        "<b>Fase 1</b> (config): mezza giornata. Soprattutto data entry e double-check dei valori.",
        "<b>Fase 2</b> (constants): un'ora.",
        "<b>Fase 3</b> (modulazione via config): poche ore. La maggior parte è già config-driven; serve solo aggiungere il flag opzionale per il buy-bonus.",
        "<b>Fase 4</b> (facade extension): mezza giornata, è codice che già scriviamo nello stile del traduttore.",
        "<b>Fase 5</b> (mock + test): mezza giornata.",
        "<b>Fase 6</b> (open items): trasversale, cresce/decresce con ciò che scopriamo.",
    ]),
    Paragraph(
        "<i>Totale grezzo: 2 giorni circa di lavoro, distribuiti su una settimana per lasciar spazio al confronto delle decisioni. La revisione di Fase 3 (niente engine surgery) ha ridotto significativamente l'effort e il rischio.</i>",
        small_style,
    ),
]))

# ---------------- Risk ----------------
story.append(section("Rischi e mitigazioni", [
    bullets([
        "<b>Riferimenti hardcoded residui</b> — l'audit iniziale dice che l'engine è simbol-agnostico, ma vale la pena un grep finale prima di chiudere la fase 3 per essere certi che nessun modulo assuma <font face='Courier'>'W'</font> o <font face='Courier'>'freegame'</font> per nome.",
        "<b>Ordine paylines diverso</b> tra Stake e Hot Fruits — i 5 pattern coincidono ma non in ordine. Rischio: payline ID mostrata all'utente non corrisponde a quella dichiarata dal server. Mitigazione: il facade riconcilia l'ID prima di passare l'evento all'engine.",
        "<b>Free spins non dichiarati nel config</b> ma potenzialmente attivati da scatter in qualche variante. Mitigazione doppia: (a) la struttura <font face='Courier'>paddingReels.freegame</font> resta nel config Stake come previsto in fase 3, quindi un eventuale trigger inatteso non manda l'engine in errore; (b) il facade logga ogni evento <font face='Courier'>freeSpinTrigger</font> ricevuto come anomalia, in attesa di indagare punto 6.",
    ]),
]))

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2 * cm, rightMargin=2 * cm,
    topMargin=2 * cm, bottomMargin=2 * cm,
    title="Piano di adattamento Stake lines verso Hot Fruits",
    author="Invisible Engine",
)
doc.build(story)
print(f"wrote {OUTPUT}")

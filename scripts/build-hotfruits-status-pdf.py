"""Build the client-facing Italian status PDF — Hot Fruits adattamento (Fase 1+4)."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT

OUTPUT = "Stato_Adattamento_HotFruits.pdf"

ACCENT = HexColor("#1f3a5f")
MUTED = HexColor("#555555")

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


def section(title, flowables):
    block = [Paragraph(title, h2_style)] + flowables
    return KeepTogether(block)


story = []

story.append(Paragraph("Adattamento Hot Fruits — stato attuale", title_style))
story.append(Paragraph(
    "Progetto Invisible Engine · ramo <font face='Courier'>hotfruits</font> · "
    "Fase 4 + Fase 1 completate",
    subtitle_style,
))

story.append(section("Cosa ho fatto in questa sessione", [
    bullets([
        "Ho <b>duplicato</b> l'app <font face='Courier'>apps/lines</font> in un nuovo "
        "<font face='Courier'>apps/hotfruits</font> su un ramo dedicato. L'app <font face='Courier'>lines</font> "
        "originale resta intatta come riferimento Stake \"vanilla\".",
        "Ho aggiunto al facade una <b>difesa al confine</b>: cattura il config che il server "
        "Play4Fun invia al boot e lo confronta con la mappa simboli interna. Mismatch, simboli "
        "sconosciuti o posizioni fuori griglia vengono segnalati nei log invece di mandare "
        "l'engine in crash.",
        "Ho <b>corretto la mappa simboli</b> per allinearla al payout reale di Hot Fruits: "
        "<font face='Courier'>PIC1 → H1</font> (simbolo che paga di più), a scendere fino a "
        "<font face='Courier'>PIC7 → L5</font> (il meno pagante, l'unico che paga anche con 2 simboli).",
        "Ho fatto il <b>trim del config</b> di Hot Fruits: paylines da 20 a 5, paytable allineata "
        "ai valori reali del server, modalità <font face='Courier'>bonus</font> rimossa, simbolo "
        "<i>wild</i> <font face='Courier'>W</font> disattivato (la struttura resta nell'engine "
        "ma il simbolo non si attiva più — pronto a essere riusato per i prossimi giochi).",
        "Ho aggiornato il <b>mock server</b> per emettere il config al boot, il paytable corretto, "
        "e i premi <i>scatter</i> 3/4/5 SCAT. Adesso il mock è fedele al protocollo reale di "
        "Hot Fruits, basta accendere il server reale per sostituirlo.",
    ]),
]))

story.append(section("Stato attuale del gioco", [
    bullets([
        "<b>Griglia 5×3</b> con 5 paylines: tre righe orizzontali più due pattern a piramide "
        "(▽ e △), esattamente come Hot Fruits.",
        "<b>Vocabolario simboli pulito:</b> 7 simboli di linea + 1 scatter. Niente wild attivo, "
        "niente buy-bonus, niente free spins.",
        "<b>Math corretta:</b> bet, vincite di linea, vincite di scatter e bilancio passano dal "
        "server al display senza perdite. La conversione centesimi ↔ unità Stake è verificata "
        "(esempio: bet $1, vincita 4× → $4.00 a schermo).",
        "<b>Engine intatto:</b> nessuna modifica ai pacchetti condivisi. Tutto il lavoro è "
        "rimasto a livello di <i>config</i> e <i>traduttore</i>. Un futuro gioco con wild, "
        "free spins o buy-bonus può riattivarli solo modificando il proprio config.",
        "<b>Stesso flusso di un browser reale:</b> il client gira su <font face='Courier'>localhost:3001</font>, "
        "parla con il mock su <font face='Courier'>localhost:7777</font>, senza bisogno di "
        "internet o autenticazione vera.",
    ]),
]))

story.append(section("Cosa resta da fare", [
    bullets([
        "<b>Rebranding grafico</b> — è la prossima cosa che farò io. Le texture dei simboli "
        "(H1–H4, L1, L2, L5, S), il frame dei rulli, lo sfondo, i font e l'audio sono tutti in "
        "<font face='Courier'>apps/hotfruits/static/assets/</font>. Sostituendo gli atlas con "
        "le grafiche di Hot Fruits non serve toccare codice.",
        "<b>Pulizie UI minori</b> — il pulsante \"buy bonus\" resta visibile perché è "
        "renderizzato di default nei layout condivisi; va nascosto con un flag opzionale nel "
        "config (lavoro piccolo).",
        "<b>Conferme dal server reale</b> — RTP esatto e valori dei premi scatter andranno "
        "verificati confrontando con una sessione live di Hot Fruits prima della messa in "
        "produzione.",
        "<b>Future espansioni</b> — multiplier (<font face='Courier'>mpInfo</font>), feature gamble e "
        "free spins (se mai un'altra variante del gioco le aggiunge) sono già supportabili dall'engine; "
        "vanno solo riattivati nel config del gioco specifico.",
    ]),
]))

doc = SimpleDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm, bottomMargin=2*cm,
    title="Adattamento Hot Fruits - stato attuale",
    author="Invisible Engine",
)
doc.build(story)
print(f"wrote {OUTPUT}")

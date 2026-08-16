"""Extraction du contenu d'un article web (débruitage).

Pourquoi ce module (voir docs/veille/2026-08-16-analyse-repos-externes.md) :
l'heuristique TypeScript existante (`extractReadableText`) cible `<article>` /
`<main>`, retire header/nav/aside/footer puis ne garde que les lignes qui
« ressemblent à de la prose ». Elle marche bien sur une page d'article classique,
mais rend `''` sur tout le reste (paywall, mur de cookies, gabarit exotique) —
et l'appelant retombe alors silencieusement sur deux lignes de flux RSS.

`trafilatura` est l'état de l'art du débruitage et récupère précisément ces
cas-là. Il est en Python, donc il vient naturellement dans ce sidecar qui fait
déjà tourner pypdf/opencv/whisper — sans nouvelle dépendance système côté Rust
ou Node, et sans VRAM.

Contrat : lever une exception si l'extraction échoue ou si trafilatura est
absent. L'appelant (`extractArticleViaSidecar`) retombe alors sur l'heuristique
TypeScript. On ne renvoie JAMAIS un texte vide déguisé en succès : l'appelant ne
pourrait pas distinguer « page vide » de « extracteur indisponible ».
"""

from typing import Any, Optional

# Sous ce seuil, ce n'est pas un article : autant laisser l'appelant décider
# (extrait RSS, heuristique TS) plutôt que de renvoyer un moignon.
MIN_ARTICLE_CHARS = 200


def extract_article(html: str, url: Optional[str] = None) -> dict[str, Any]:
    """Renvoie {title, text, date, author, method}. Lève si rien d'exploitable."""
    if not html or not html.strip():
        raise ValueError("html vide")

    try:
        import trafilatura
        from trafilatura.settings import use_config
    except ImportError as exc:  # pragma: no cover - dépend de l'environnement
        raise RuntimeError(
            "trafilatura non installé. Dans le sidecar Python: pip install trafilatura"
        ) from exc

    # Coupe le téléchargement de signaux externes : on fournit déjà le HTML, et
    # un appel réseau surprise depuis le sidecar serait contraire au local-first.
    config = use_config()
    config.set("DEFAULT", "EXTRACTION_TIMEOUT", "0")

    text = trafilatura.extract(
        html,
        url=url,
        favor_precision=True,      # préfère perdre un paragraphe que garder un menu
        include_comments=False,    # fils de commentaires = bruit pour un digest
        include_tables=True,       # les tableaux portent souvent les chiffres cités
        no_fallback=False,         # laisse trafilatura tenter ses replis internes
        config=config,
    )

    if not text or len(text.strip()) < MIN_ARTICLE_CHARS:
        raise ValueError("aucun contenu d'article exploitable")

    title = None
    date = None
    author = None
    try:
        meta = trafilatura.extract_metadata(html, default_url=url)
        if meta is not None:
            title = getattr(meta, "title", None)
            date = getattr(meta, "date", None)
            author = getattr(meta, "author", None)
    except Exception:  # noqa: BLE001 - les métadonnées sont un bonus, jamais bloquantes
        pass

    return {
        "title": title,
        "text": text.strip(),
        "date": date,
        "author": author,
        "method": "trafilatura",
    }

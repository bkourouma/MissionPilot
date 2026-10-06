"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { TypeEntiteCollaboration } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  insererMention,
  requeteMention,
  TAILLE_COMMENTAIRE_MAX,
  type Mentionnable,
  type RequeteMention,
} from "../../lib/commentaires";
import { CadreChamp, idsDescription } from "../ui/Champ";

export interface SaisieMentionsProps {
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  /** Personne choisie dans la liste (sa mention sera envoyée si « @Nom » reste dans le texte). */
  onMention: (m: Mentionnable) => void;
  entiteType: TypeEntiteCollaboration;
  entiteId: string;
  erreur?: string;
  aide?: string;
  /** Ctrl+Entrée (ou Cmd+Entrée) : publier. */
  onValider?: () => void;
  ref?: Ref<HTMLTextAreaElement>;
}

const SUGGESTIONS_MAX = 8;
const DELAI_RECHERCHE_MS = 250;

/**
 * Zone de saisie d'un commentaire avec mentions « @ ». Taper « @ » puis le début d'un nom
 * propose les personnes qui voient l'élément (API « mentionnables »). Clavier : flèches haut et
 * bas pour parcourir, Entrée ou Tab pour insérer, Échap pour fermer. Le nombre de suggestions
 * est annoncé aux lecteurs d'écran ; la zone reste une zone de texte ordinaire.
 */
export function SaisieMentions({
  libelle,
  valeur,
  onChange,
  onMention,
  entiteType,
  entiteId,
  erreur,
  aide,
  onValider,
  ref,
}: SaisieMentionsProps) {
  const id = useId();
  const idListe = `${id}-suggestions`;
  const zone = useRef<HTMLTextAreaElement | null>(null);
  const cache = useRef(new Map<string, Mentionnable[]>());
  const [requete, setRequete] = useState<RequeteMention | null>(null);
  const [suggestions, setSuggestions] = useState<Mentionnable[]>([]);
  const [actif, setActif] = useState(0);
  const [annonce, setAnnonce] = useState("");
  const [curseurApres, setCurseurApres] = useState<number | null>(null);

  // Recherche des personnes mentionnables, retardée pendant la frappe et mise en cache.
  useEffect(() => {
    if (!requete) return;
    const cle = requete.requete.trim().toLowerCase();
    const enCache = cache.current.get(cle);
    if (enCache) {
      setSuggestions(enCache.slice(0, SUGGESTIONS_MAX));
      setActif(0);
      return;
    }
    const controle = new AbortController();
    const minuterie = setTimeout(async () => {
      const q = new URLSearchParams({ entite_type: entiteType, entite_id: entiteId });
      if (cle) q.set("q", cle);
      try {
        const r = await api.get<{ elements: Mentionnable[] }>(
          `/api/commentaires/mentionnables?${q.toString()}`,
          { signal: controle.signal, delaiMs: 10_000 },
        );
        cache.current.set(cle, r.elements);
        setSuggestions(r.elements.slice(0, SUGGESTIONS_MAX));
        setActif(0);
      } catch {
        // Hors connexion : pas de suggestion, la saisie reste possible.
        setSuggestions([]);
      }
    }, DELAI_RECHERCHE_MS);
    return () => {
      clearTimeout(minuterie);
      controle.abort();
    };
  }, [requete, entiteType, entiteId]);

  const ouverte = requete !== null && suggestions.length > 0;

  useEffect(() => {
    if (!requete) return setAnnonce("");
    if (suggestions.length === 0) return setAnnonce("");
    setAnnonce(
      `${suggestions.length === 1 ? "1 personne proposée" : `${suggestions.length} personnes proposées`} : flèches pour choisir, Entrée pour insérer.`,
    );
  }, [requete, suggestions]);

  // Replace le curseur après l'insertion d'une mention.
  useEffect(() => {
    if (curseurApres === null || !zone.current) return;
    zone.current.focus();
    zone.current.setSelectionRange(curseurApres, curseurApres);
    setCurseurApres(null);
  }, [curseurApres, valeur]);

  function analyser(texte: string, curseur: number) {
    setRequete(requeteMention(texte, curseur));
  }

  function choisir(m: Mentionnable) {
    if (!requete || !zone.current) return;
    const r = insererMention(valeur, requete, zone.current.selectionStart ?? valeur.length, m.nom);
    onChange(r.texte);
    onMention(m);
    setRequete(null);
    setSuggestions([]);
    setCurseurApres(r.curseur);
    setAnnonce(`${m.nom} mentionné.`);
  }

  function surTouche(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter" && onValider) {
      ev.preventDefault();
      onValider();
      return;
    }
    if (!ouverte) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActif((a) => (a + 1) % suggestions.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActif((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      ev.preventDefault();
      const m = suggestions[actif];
      if (m) choisir(m);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      setRequete(null);
      setSuggestions([]);
    }
  }

  const { describedBy } = idsDescription(id, Boolean(aide), Boolean(erreur));
  return (
    <div className="mp-mentions">
      <CadreChamp id={id} libelle={libelle} aide={aide} erreur={erreur}>
        <textarea
          ref={(el) => {
            zone.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = el;
          }}
          id={id}
          rows={3}
          maxLength={TAILLE_COMMENTAIRE_MAX}
          className="mp-champ__controle mp-zone-texte"
          value={valeur}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={describedBy}
          aria-autocomplete="list"
          aria-controls={ouverte ? idListe : undefined}
          aria-activedescendant={ouverte ? `${idListe}-${actif}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            analyser(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={surTouche}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              analyser(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }}
          onClick={(e) => analyser(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => {
            // Laisse le temps au clic sur une suggestion.
            setTimeout(() => setRequete(null), 150);
          }}
        />
      </CadreChamp>
      {ouverte ? (
        <ul
          id={idListe}
          role="listbox"
          aria-label="Personnes à mentionner"
          className="mp-mentions__liste"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              id={`${idListe}-${i}`}
              role="option"
              aria-selected={i === actif}
              className={
                i === actif
                  ? "mp-mentions__option mp-mentions__option--active"
                  : "mp-mentions__option"
              }
              onMouseDown={(e) => {
                e.preventDefault();
                choisir(m);
              }}
            >
              {m.nom}
            </li>
          ))}
        </ul>
      ) : null}
      <span className="mp-visuellement-cache" role="status">
        {annonce}
      </span>
    </div>
  );
}

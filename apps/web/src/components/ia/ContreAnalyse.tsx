"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ErreurApi } from "../../lib/api";
import {
  cheminRevues,
  estRevueDejaActive,
  MENTION_REVUE,
  MENTION_REVUE_EN,
  messageErreurRevue,
  MESSAGE_REVUE_ACTIVE,
  MESSAGE_REVUE_ACTIVE_EN,
  normaliserListeRevues,
  normaliserRevue,
  resumeRevue,
  SECTIONS_REVUE,
  SECTIONS_REVUE_EN,
  type RevueContradictoire,
} from "../../lib/contradicteur";
import { formaterDateHeure } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import "./ia.css";

export interface ContreAnalyseProps {
  /** Identifiant du brouillon IA à relire (génération « brouillon IA » ou « modifié »). */
  generationId: string;
}

type Message = { tonalite: "danger" | "info" | "succes"; texte: string };

/**
 * « Demander une contre-analyse » (AGT-06) : l'agent contradicteur relit le brouillon à la demande
 * du consultant et liste contre-preuves, incohérences et affirmations non sourcées. Résultat =
 * brouillon IA à examiner, jamais un verdict ni un blocage ; le brouillon relu n'est pas modifié.
 * Monter avec `key={generationId}`.
 */
export function ContreAnalyse({ generationId }: ContreAnalyseProps) {
  const t = useT();
  const langue = useLangue();
  const idTitre = useId();
  const [revues, setRevues] = useState<RevueContradictoire[]>([]);
  const [active, setActive] = useState(false);
  const [charge, setCharge] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);

  const lire = useCallback(async () => {
    try {
      const l = normaliserListeRevues(await api.get<unknown>(cheminRevues(generationId)));
      setRevues(l.elements);
      setActive(l.revue_active);
    } catch (e) {
      // Historique illisible (droits, réseau) : la demande reste possible.
      if (!(e instanceof ErreurApi && (e.statut === 403 || e.statut === 404))) {
        setMessage({
          tonalite: "info",
          texte: t(
            "L'historique des contre-analyses est indisponible.",
            "The counter-analysis history is unavailable.",
          ),
        });
      }
    } finally {
      setCharge(true);
    }
  }, [generationId, t]);

  useEffect(() => {
    void lire();
  }, [lire]);

  useEffect(() => {
    if (message?.tonalite === "danger") refAlerte.current?.focus();
  }, [message]);

  async function demander() {
    setEnCours(true);
    setMessage(null);
    try {
      const revue = normaliserRevue(
        await api.post<unknown>("/api/agents/revues-contradictoires", {
          generation_id: generationId,
        }),
      );
      if (revue) setRevues((r) => [revue, ...r.filter((x) => x.id !== revue.id)]);
      setActive(false);
      setMessage({
        tonalite: "succes",
        texte: revue
          ? t(
              `Contre-analyse terminée : ${resumeRevue(revue.contenu).toLowerCase()}.`,
              `Counter-analysis completed: ${resumeRevue(revue.contenu, "en").toLowerCase()}.`,
            )
          : t("Contre-analyse demandée.", "Counter-analysis requested."),
      });
      if (!revue) await lire();
    } catch (e) {
      if (estRevueDejaActive(e)) {
        setActive(true);
        setMessage({ tonalite: "info", texte: t(MESSAGE_REVUE_ACTIVE, MESSAGE_REVUE_ACTIVE_EN) });
      } else {
        setMessage({ tonalite: "danger", texte: messageErreurRevue(e, langue) });
      }
    } finally {
      setEnCours(false);
    }
  }

  const [derniere, ...anciennes] = revues;

  return (
    <section className="mp-contre-analyse" aria-labelledby={idTitre}>
      <h4 id={idTitre} className="mp-contenu-ia__titre">
        {t("Contre-analyse", "Counter-analysis")}
      </h4>
      <p className="mp-texte-petit mp-texte-doux">
        {t(
          `À votre demande, l'IA relit ce brouillon à la recherche d'objections. ${MENTION_REVUE}`,
          `At your request, the AI reviews this draft looking for objections. ${MENTION_REVUE_EN}`,
        )}
      </p>
      <div className="mp-barre-actions">
        <Bouton
          variante="secondaire"
          chargement={enCours}
          texteChargement={t("Contre-analyse en cours…", "Counter-analysis in progress…")}
          disabled={active}
          onClick={() => void demander()}
        >
          {t("Demander une contre-analyse", "Request a counter-analysis")}
        </Bouton>
        {active ? (
          <>
            <span className="mp-texte-petit">
              {t("Une contre-analyse est déjà en cours.", "A counter-analysis is already running.")}
            </span>
            <Bouton variante="secondaire" onClick={() => void lire()}>
              {t("Actualiser", "Refresh")}
            </Bouton>
          </>
        ) : null}
      </div>
      <div aria-live="polite">
        {message ? (
          <Alerte
            ref={message.tonalite === "danger" ? refAlerte : undefined}
            tonalite={message.tonalite}
            annonce={message.tonalite === "danger" ? "alert" : "aucune"}
            titre={
              message.tonalite === "danger"
                ? t("Contre-analyse impossible", "Counter-analysis not possible")
                : undefined
            }
          >
            <p>{message.texte}</p>
          </Alerte>
        ) : null}
      </div>
      {derniere ? <ResultatRevue revue={derniere} /> : null}
      {charge && !derniere && !active ? (
        <p className="mp-texte-petit mp-texte-doux">
          {t(
            "Aucune contre-analyse demandée pour l'instant.",
            "No counter-analysis requested yet.",
          )}
        </p>
      ) : null}
      {anciennes.length > 0 ? (
        <details className="mp-details">
          <summary>
            {t(
              `Revues précédentes (${anciennes.length})`,
              `Previous reviews (${anciennes.length})`,
            )}
          </summary>
          <div className="mp-pile">
            {anciennes.map((r) => (
              <ResultatRevue key={r.id} revue={r} />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Une revue : trois listes, nombres non vérifiés, état vide. Jamais un verdict. */
function ResultatRevue({ revue }: { revue: RevueContradictoire }) {
  const t = useT();
  const langue = useLangue();
  const c = revue.contenu;
  const vide =
    c.contre_preuves.length + c.incoherences.length + c.affirmations_non_sourcees.length === 0;
  return (
    <div className="mp-contre-analyse__section">
      <p className="mp-texte-petit">
        {`${t("Brouillon IA", "AI draft")}${revue.cree_le ? ` · ${formaterDateHeure(revue.cree_le, undefined, langue)}` : ""} · ${resumeRevue(c, langue)}`}
      </p>
      {vide ? (
        <p>{t("Aucune objection relevée.", "No objection raised.")}</p>
      ) : (
        SECTIONS_REVUE.map((s) => {
          const items = c[s.cle];
          return (
            <div key={s.cle} className="mp-contre-analyse__section">
              <h5>{`${langue === "en" ? SECTIONS_REVUE_EN[s.cle].titre : s.titre} (${items.length})`}</h5>
              {items.length === 0 ? (
                <p className="mp-texte-petit mp-texte-doux">{t("Aucune.", "None.")}</p>
              ) : (
                <ul className="mp-contre-analyse__liste">
                  {items.map((texte, i) => (
                    <li key={i}>{texte}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
      {revue.nombres_non_verifies.length > 0 ? (
        <p className="mp-texte-petit">
          {t(
            `Nombres non vérifiés dans cette revue (ils ne viennent pas des moteurs de calcul) : ${revue.nombres_non_verifies.join(", ")}.`,
            `Unverified numbers in this review (they do not come from the calculation engines): ${revue.nombres_non_verifies.join(", ")}.`,
          )}
        </p>
      ) : null}
    </div>
  );
}

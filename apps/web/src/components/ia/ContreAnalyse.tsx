"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ErreurApi } from "../../lib/api";
import {
  cheminRevues,
  estRevueDejaActive,
  MENTION_REVUE,
  messageErreurRevue,
  MESSAGE_REVUE_ACTIVE,
  normaliserListeRevues,
  normaliserRevue,
  resumeRevue,
  SECTIONS_REVUE,
  type RevueContradictoire,
} from "../../lib/contradicteur";
import { formaterDateHeure } from "../../lib/format";
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
          texte: "L'historique des contre-analyses est indisponible.",
        });
      }
    } finally {
      setCharge(true);
    }
  }, [generationId]);

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
          ? `Contre-analyse terminée : ${resumeRevue(revue.contenu).toLowerCase()}.`
          : "Contre-analyse demandée.",
      });
      if (!revue) await lire();
    } catch (e) {
      if (estRevueDejaActive(e)) {
        setActive(true);
        setMessage({ tonalite: "info", texte: MESSAGE_REVUE_ACTIVE });
      } else {
        setMessage({ tonalite: "danger", texte: messageErreurRevue(e) });
      }
    } finally {
      setEnCours(false);
    }
  }

  const [derniere, ...anciennes] = revues;

  return (
    <section className="mp-contre-analyse" aria-labelledby={idTitre}>
      <h4 id={idTitre} className="mp-contenu-ia__titre">
        Contre-analyse
      </h4>
      <p className="mp-texte-petit mp-texte-doux">
        {`À votre demande, l'IA relit ce brouillon à la recherche d'objections. ${MENTION_REVUE}`}
      </p>
      <div className="mp-barre-actions">
        <Bouton
          variante="secondaire"
          chargement={enCours}
          texteChargement="Contre-analyse en cours…"
          disabled={active}
          onClick={() => void demander()}
        >
          Demander une contre-analyse
        </Bouton>
        {active ? (
          <>
            <span className="mp-texte-petit">Une contre-analyse est déjà en cours.</span>
            <Bouton variante="secondaire" onClick={() => void lire()}>
              Actualiser
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
            titre={message.tonalite === "danger" ? "Contre-analyse impossible" : undefined}
          >
            <p>{message.texte}</p>
          </Alerte>
        ) : null}
      </div>
      {derniere ? <ResultatRevue revue={derniere} /> : null}
      {charge && !derniere && !active ? (
        <p className="mp-texte-petit mp-texte-doux">
          Aucune contre-analyse demandée pour l&apos;instant.
        </p>
      ) : null}
      {anciennes.length > 0 ? (
        <details className="mp-details">
          <summary>{`Revues précédentes (${anciennes.length})`}</summary>
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
  const c = revue.contenu;
  const vide =
    c.contre_preuves.length + c.incoherences.length + c.affirmations_non_sourcees.length === 0;
  return (
    <div className="mp-contre-analyse__section">
      <p className="mp-texte-petit">
        {`Brouillon IA${revue.cree_le ? ` · ${formaterDateHeure(revue.cree_le)}` : ""} · ${resumeRevue(c)}`}
      </p>
      {vide ? (
        <p>Aucune objection relevée.</p>
      ) : (
        SECTIONS_REVUE.map((s) => {
          const items = c[s.cle];
          return (
            <div key={s.cle} className="mp-contre-analyse__section">
              <h5>{`${s.titre} (${items.length})`}</h5>
              {items.length === 0 ? (
                <p className="mp-texte-petit mp-texte-doux">Aucune.</p>
              ) : (
                <ul className="mp-contre-analyse__liste">
                  {items.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
      {revue.nombres_non_verifies.length > 0 ? (
        <p className="mp-texte-petit">
          {`Nombres non vérifiés dans cette revue (ils ne viennent pas des moteurs de calcul) : ${revue.nombres_non_verifies.join(", ")}.`}
        </p>
      ) : null}
    </div>
  );
}

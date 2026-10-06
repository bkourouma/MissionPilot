"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ErreurApi } from "../../lib/api";
import {
  annonceCalcul,
  cheminActionNotation,
  cheminNotationMission,
  hrefNotation,
  messageNotation,
  optionsEnvois,
  optionsGrillesCalcul,
  optionsSecteurs,
  SECTEURS_GENERIQUES,
  STRATEGIES,
  validerCalcul,
  type EnvoiQuestionnaire,
  type ResumeNotation,
  type VueVersionNotation,
} from "../../lib/notation";
import { cheminVersionGrille, type VersionGrille } from "../../lib/notation-grilles";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface FormulaireCalculProps {
  missionId: string;
  /** Notation de la mission ; null : elle sera ouverte au premier calcul. */
  notationId: string | null;
  /** Envois de questionnaires de la mission (titres et nombres de réponses, jamais le contenu). */
  envois: EnvoiQuestionnaire[];
  /** Grilles du cabinet (seules celles qui ont une version validée sont proposées). */
  grilles: { titre: string; code: string; version_validee_id: string | null }[];
}

type Secteurs = readonly { secteur: string; libelle?: string }[];

/** Ouvre la notation de la mission si besoin (409 : elle existe déjà, on la relit). */
async function notationDeLaMission(missionId: string, notationId: string | null) {
  if (notationId) return notationId;
  try {
    return (await api.post<ResumeNotation>(cheminNotationMission(missionId), {})).id;
  } catch (e) {
    if (e instanceof ErreurApi && e.statut === 409) {
      return (await api.get<ResumeNotation>(cheminNotationMission(missionId))).id;
    }
    throw e;
  }
}

/**
 * Lancement d'un calcul (nouvelle version figée) sur les réponses SOUMISES d'un questionnaire de
 * la mission : grille validée (générique par défaut), secteur de pondération, traitement des
 * réponses manquantes. Le score vient du moteur de l'API ; la page l'affiche ensuite.
 */
export function FormulaireCalcul({
  missionId,
  notationId,
  envois,
  grilles,
}: FormulaireCalculProps) {
  const router = useRouter();
  const id = useId();
  const f = useFormulaire<"envoiId" | "strategie">();
  const premierNotable = envois.find((e) => e.reponses_soumises > 0)?.id ?? "";
  const [envoiId, setEnvoiId] = useState(premierNotable);
  const [grilleVersionId, setGrilleVersionId] = useState("");
  const [secteur, setSecteur] = useState("");
  const [strategie, setStrategie] = useState<"ignorer" | "penaliser">("ignorer");
  const [secteurs, setSecteurs] = useState<Secteurs>(SECTEURS_GENERIQUES);
  const [chargementSecteurs, setChargementSecteurs] = useState(false);
  const [erreurSecteurs, setErreurSecteurs] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const verrou = useRef(false);

  // Secteurs de la grille choisie : ceux de la générique, ou ceux de la version validée choisie.
  useEffect(() => {
    setSecteur("");
    setErreurSecteurs(null);
    if (grilleVersionId === "") {
      setSecteurs(SECTEURS_GENERIQUES);
      return;
    }
    const controleur = new AbortController();
    setChargementSecteurs(true);
    api
      .get<VersionGrille>(cheminVersionGrille(grilleVersionId), { signal: controleur.signal })
      .then((v) => setSecteurs(v.contenu.secteurs ?? []))
      .catch((e: unknown) => {
        if (e instanceof ErreurApi && e.code === "ANNULE") return;
        setSecteurs([]);
        setErreurSecteurs(
          `Les secteurs de cette grille n'ont pas pu être chargés (${messageNotation(e)}) : le calcul utilisera ses pondérations par défaut.`,
        );
      })
      .finally(() => setChargementSecteurs(false));
    return () => controleur.abort();
  }, [grilleVersionId]);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    setAnnonce("");
    try {
      await f.envoyer(
        validerCalcul({ envoiId, grilleVersionId, secteur, strategie }, envois),
        async (charge) => {
          const idNotation = await notationDeLaMission(missionId, notationId);
          return api.post<VueVersionNotation>(cheminActionNotation(idNotation, "calculs"), charge);
        },
        {
          rafraichir: false,
          messageSpecifique: messageNotation,
          apres: (vue) => {
            setAnnonce(annonceCalcul(vue));
            router.push(hrefNotation(missionId, vue.numero));
          },
        },
      );
    } finally {
      verrou.current = false;
    }
  }

  const grillesProposees = optionsGrillesCalcul(grilles);
  const nonValidees = grilles.filter((g) => g.version_validee_id === null).length;
  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p className="mp-visuellement-cache" role="status">
        {annonce}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Calcul impossible"
      />
      {annonce ? (
        <Alerte tonalite="succes" annonce="aucune">
          <p>{annonce}</p>
        </Alerte>
      ) : null}
      <Select
        libelle="Questionnaire noté"
        required
        value={envoiId}
        onChange={(e) => setEnvoiId(e.target.value)}
        invite="Choisir un questionnaire…"
        options={optionsEnvois(envois)}
        erreur={f.erreurs.envoiId}
        aide="Seules les réponses SOUMISES par le client sont notées ; les brouillons sont ignorés."
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Grille de notation"
          value={grilleVersionId}
          onChange={(e) => setGrilleVersionId(e.target.value)}
          options={grillesProposees}
          aide={
            nonValidees > 0
              ? `Grilles du cabinet non proposées faute de version validée : ${nonValidees}. Une grille n'est proposée qu'une fois validée par un expert métier.`
              : "Une grille du cabinet n'est proposée qu'une fois validée par un expert métier."
          }
        />
        <Select
          libelle="Pondérations par secteur"
          value={secteur}
          onChange={(e) => setSecteur(e.target.value)}
          options={optionsSecteurs(secteurs)}
          disabled={chargementSecteurs}
          aria-busy={chargementSecteurs || undefined}
          aide={
            chargementSecteurs
              ? "Chargement des secteurs de la grille…"
              : (erreurSecteurs ?? undefined)
          }
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Réponses manquantes</legend>
        <div className="mp-groupe__options">
          {(["ignorer", "penaliser"] as const).map((s) => (
            <div key={s} className="mp-case">
              <input
                type="radio"
                className="mp-case__controle"
                id={`${id}-${s}`}
                name={`${id}-strategie`}
                value={s}
                checked={strategie === s}
                onChange={() => setStrategie(s)}
                aria-describedby={`${id}-${s}-aide`}
              />
              <label htmlFor={`${id}-${s}`} className="mp-case__libelle">
                {STRATEGIES[s].libelle}
                <span id={`${id}-${s}-aide`} className="mp-case__aide">
                  {STRATEGIES[s].aide}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement="Calcul en cours…"
          disabled={chargementSecteurs}
        >
          Lancer le calcul
        </Bouton>
      </div>
      <p className="mp-texte-doux mp-texte-petit">
        Chaque calcul crée une nouvelle version en brouillon, figée et horodatée ; les versions
        précédentes restent consultables. Les ajustements d&apos;une version ne sont pas reportés
        sur la suivante.
      </p>
    </form>
  );
}

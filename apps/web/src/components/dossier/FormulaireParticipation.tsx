"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api, messageErreur } from "../../lib/api";
import type { DossierResume } from "../../lib/dossier";
import {
  cheminApiParticipations,
  estFinDeDetention,
  formaterPart,
  OPTIONS_SENS,
  saisieParticipationVide,
  validerParticipation,
  type ChampParticipation,
  type ParticipationActive,
  type SaisieParticipation,
  type SensParticipation,
} from "../../lib/dossier-groupes";
import "./groupe.css";

const DELAI_RECHERCHE_MS = 300;

/**
 * Saisie d'une participation (DOS-05) : le dossier courant détient l'autre dossier ou en est
 * détenu. Ajout seul : « Mettre fin à la détention » enregistre une participation à 0 % avec un
 * motif. Les refus d'ensemble (cycle, total supérieur à 100 %) viennent de l'API et sont affichés
 * tels quels. Le choix de l'autre dossier se limite aux dossiers visibles de l'utilisateur.
 */
export function FormulaireParticipation({
  clientId,
  dateParDefaut,
  actives,
}: {
  clientId: string;
  dateParDefaut: string;
  actives: readonly ParticipationActive[];
}) {
  const [s, setS] = useState<SaisieParticipation>(saisieParticipationVide(dateParDefaut));
  const f = useFormulaire<ChampParticipation>();
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<DossierResume[]>([]);
  const [choisi, setChoisi] = useState<{ id: string; nom: string } | null>(null);
  const [erreurRecherche, setErreurRecherche] = useState<string | null>(null);
  const refPourcentage = useRef<HTMLInputElement>(null);
  const maj = <K extends keyof SaisieParticipation>(k: K, v: SaisieParticipation[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const fin = estFinDeDetention(s);

  useEffect(() => {
    let annule = false;
    const minuterie = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ limite: "20" });
        if (recherche.trim()) q.set("q", recherche.trim().slice(0, 100));
        const r = await api.get<{ elements: DossierResume[] }>(`/api/dossiers?${q.toString()}`);
        if (annule) return;
        setResultats(r.elements.filter((d) => d.id !== clientId));
        setErreurRecherche(null);
      } catch (e) {
        if (!annule) setErreurRecherche(messageErreur(e));
      }
    }, DELAI_RECHERCHE_MS);
    return () => {
      annule = true;
      clearTimeout(minuterie);
    };
  }, [recherche, clientId]);

  const options = [...resultats.map((d) => ({ valeur: d.id, libelle: d.raison_sociale }))];
  if (choisi && !options.some((o) => o.valeur === choisi.id)) {
    options.unshift({ valeur: choisi.id, libelle: choisi.nom });
  }

  function choisirAutre(id: string) {
    maj("autre_id", id);
    const trouve = resultats.find((d) => d.id === id);
    if (trouve) setChoisi({ id, nom: trouve.raison_sociale });
  }

  function preparerFin(a: ParticipationActive) {
    const detient = a.detenteurId === clientId;
    const autreId = detient ? a.filialeId : a.detenteurId;
    const autreNom = detient ? a.filialeNom : a.detenteurNom;
    setChoisi({ id: autreId, nom: autreNom });
    setS((x) => ({
      ...x,
      sens: detient ? "detient" : "detenu",
      autre_id: autreId,
      pourcentage: "0",
    }));
    refPourcentage.current?.focus();
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerParticipation(clientId, s),
      (charge) => api.post(cheminApiParticipations(clientId), charge),
      {
        succes: fin ? "La fin de détention est enregistrée." : "La participation est enregistrée.",
        apres: () => {
          setS(saisieParticipationVide(dateParDefaut));
          setChoisi(null);
        },
      },
    );
  }

  return (
    <div className="mp-groupe">
      {actives.length > 0 ? (
        <div>
          <h3 className="mp-carte__titre">Participations en vigueur</h3>
          <ul className="mp-groupe-actives">
            {actives.map((a) => {
              const detient = a.detenteurId === clientId;
              const autre = detient ? a.filialeNom : a.detenteurNom;
              return (
                <li key={a.id}>
                  <span>
                    {detient ? "Détient" : "Est détenu par"} <strong>{autre}</strong> à{" "}
                    {formaterPart(a.points)}
                  </span>
                  <Bouton variante="secondaire" onClick={() => preparerFin(a)}>
                    Mettre fin à la détention
                    <span className="mp-visuellement-cache"> avec {autre}</span>
                  </Bouton>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label="Saisir une participation"
      >
        <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-grille-champs">
          <Select
            libelle="Sens de la détention"
            options={OPTIONS_SENS}
            value={s.sens}
            onChange={(e) => maj("sens", e.target.value as SensParticipation)}
          />
          <Champ
            libelle="Rechercher l'autre dossier"
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            maxLength={100}
            autoComplete="off"
            aide="Parmi les dossiers visibles avec vos droits."
            erreur={erreurRecherche ?? undefined}
          />
          <Select
            libelle="Autre dossier"
            required
            invite="Choisir…"
            options={options}
            value={s.autre_id}
            onChange={(e) => choisirAutre(e.target.value)}
            erreur={f.erreurs.autre_id}
          />
          <Champ
            ref={refPourcentage}
            libelle="Pourcentage détenu"
            required
            inputMode="decimal"
            value={s.pourcentage}
            onChange={(e) => maj("pourcentage", e.target.value)}
            erreur={f.erreurs.pourcentage}
            aide="De 0 à 100, deux décimales au plus (ex. 33,33). 0 met fin à la détention."
            autoComplete="off"
          />
          <Champ
            libelle="Date d'effet"
            type="date"
            required
            value={s.date_effet}
            onChange={(e) => maj("date_effet", e.target.value)}
            erreur={f.erreurs.date_effet}
          />
        </div>
        <ZoneTexte
          libelle={fin ? "Motif de la fin de détention (obligatoire)" : "Motif"}
          required={fin}
          rows={2}
          maxLength={500}
          value={s.motif}
          onChange={(e) => maj("motif", e.target.value)}
          erreur={f.erreurs.motif}
        />
        <div className="mp-actions-formulaire">
          <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
            {fin ? "Enregistrer la fin de détention" : "Enregistrer la participation"}
          </Bouton>
        </div>
      </form>
    </div>
  );
}

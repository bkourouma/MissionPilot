"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DEVISES } from "@missionpilot/shared";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ErreurApi, api, messageErreur } from "../../lib/api";
import {
  AIDE_IMPORT_ETAT,
  cheminApiDossier,
  cheminImportExcel,
  erreursImport,
  STATUT_ETAT,
  validerImportEtat,
  type ChampImportEtat,
  type EtatDetaille,
  type SaisieImportEtat,
} from "../../lib/dossier";
import type { Devise } from "../../lib/format";
import { televerser } from "../../lib/televersement";

/**
 * Import d'un état financier (DOS-03) depuis un classeur .xlsx ou un CSV. L'API lit le fichier
 * (lecteur borné), contrôle l'équilibre par son moteur et l'accepte automatiquement SEULEMENT si
 * tous les contrôles passent ; sinon l'état part en revue avec ses écarts. Une ligne illisible
 * bloque l'import : rien n'est écrit, chaque ligne en erreur est citée.
 */
export function ImportEtat({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [s, setS] = useState<SaisieImportEtat>({
    exercice: "",
    date_cloture: "",
    devise: "XOF",
    tolerance: "",
  });
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreurs, setErreurs] = useState<Partial<Record<ChampImportEtat, string>>>({});
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<{
    message: string;
    lignes: { ligne: number; message: string }[];
  } | null>(null);
  const [resultat, setResultat] = useState<EtatDetaille | null>(null);
  const maj = <K extends keyof SaisieImportEtat>(k: K, v: SaisieImportEtat[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function envoyer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setEchec(null);
    setResultat(null);
    const v = validerImportEtat(s, fichier);
    if (!v.ok) return setErreurs(v.erreurs);
    setErreurs({});
    setEnCours(true);
    try {
      const { format, ...entete } = v.charge;
      const etat =
        format === "excel"
          ? await televerser<EtatDetaille>(
              cheminImportExcel(clientId, entete),
              fichier as File,
              (fichier as File).name,
            )
          : await api.post<EtatDetaille>(
              `${cheminApiDossier(clientId)}/etats-financiers/csv`,
              {
                ...entete,
                csv: await (fichier as File).text(),
                nom_fichier: (fichier as File).name,
              },
              { delaiMs: 60_000 },
            );
      setResultat(etat);
      router.refresh();
    } catch (e) {
      setEchec({
        message: messageErreur(e),
        lignes:
          e instanceof ErreurApi && e.code === "IMPORT_INVALIDE" ? erreursImport(e.details) : [],
      });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={envoyer}
      aria-label="Importer un état financier"
    >
      <p>{AIDE_IMPORT_ETAT}</p>
      <div className="mp-grille-champs">
        <Champ
          libelle="Exercice"
          required
          inputMode="numeric"
          maxLength={4}
          value={s.exercice}
          onChange={(e) => maj("exercice", e.target.value)}
          erreur={erreurs.exercice}
        />
        <Champ
          libelle="Date de clôture"
          type="date"
          required
          value={s.date_cloture}
          onChange={(e) => maj("date_cloture", e.target.value)}
          erreur={erreurs.date_cloture}
        />
        <Select
          libelle="Devise"
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
          value={s.devise}
          onChange={(e) => maj("devise", e.target.value as Devise)}
        />
        <Champ
          libelle="Tolérance des contrôles"
          inputMode="numeric"
          value={s.tolerance}
          onChange={(e) => maj("tolerance", e.target.value)}
          erreur={erreurs.tolerance}
          aide="En unités mineures (FCFA, centimes) ; 0 par défaut. Utile pour des comptes arrondis."
        />
        <Champ
          libelle="Fichier"
          type="file"
          required
          accept=".xlsx,.csv"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          erreur={erreurs.fichier}
        />
      </div>
      {echec ? (
        <Alerte tonalite="danger" titre="Import refusé">
          <p>{echec.message}</p>
          {echec.lignes.length > 0 ? (
            <ul>
              {echec.lignes.map((l) => (
                <li key={`${l.ligne}-${l.message}`}>{l.message}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
      {resultat ? (
        <Alerte
          tonalite={resultat.statut === "accepte" ? "succes" : "attention"}
          titre={`État ${resultat.exercice} : ${STATUT_ETAT[resultat.statut].libelle.toLowerCase()}`}
        >
          <p>
            {resultat.statut === "accepte"
              ? "Tous les contrôles passent : l'état est accepté automatiquement."
              : `${resultat.ecarts} écart(s), ${resultat.non_verifiables} contrôle(s) non vérifiable(s) : l'état attend une revue.`}{" "}
            <a
              href={`/dossiers/${encodeURIComponent(clientId)}/finances/${encodeURIComponent(resultat.id)}`}
            >
              Voir le détail
            </a>
          </p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="telechargement"
          chargement={enCours}
          texteChargement="Import en cours…"
        >
          Importer et contrôler
        </Bouton>
      </div>
    </form>
  );
}

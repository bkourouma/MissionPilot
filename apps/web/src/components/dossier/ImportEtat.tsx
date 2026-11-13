"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState, type FormEvent } from "react";
import { DEVISES } from "@missionpilot/shared";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { ErreurApi, api, messageErreur } from "../../lib/api";
import {
  aideImportEtat,
  cheminApiDossier,
  cheminImportExcel,
  erreursImport,
  statutEtat,
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
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
    const v = validerImportEtat(s, fichier, langue);
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
      rafraichir();
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
      aria-label={t("Importer un état financier", "Import a financial statement")}
    >
      <p>{aideImportEtat(langue)}</p>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Exercice", "Fiscal year")}
          required
          inputMode="numeric"
          maxLength={4}
          value={s.exercice}
          onChange={(e) => maj("exercice", e.target.value)}
          erreur={erreurs.exercice}
        />
        <Champ
          libelle={t("Date de clôture", "Closing date")}
          type="date"
          required
          value={s.date_cloture}
          onChange={(e) => maj("date_cloture", e.target.value)}
          erreur={erreurs.date_cloture}
        />
        <Select
          libelle={t("Devise", "Currency")}
          options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
          value={s.devise}
          onChange={(e) => maj("devise", e.target.value as Devise)}
        />
        <Champ
          libelle={t("Tolérance des contrôles", "Check tolerance")}
          inputMode="numeric"
          value={s.tolerance}
          onChange={(e) => maj("tolerance", e.target.value)}
          erreur={erreurs.tolerance}
          aide={t(
            "En unités mineures (FCFA, centimes) ; 0 par défaut. Utile pour des comptes arrondis.",
            "In minor units (FCFA, cents); 0 by default. Useful for rounded accounts.",
          )}
        />
        <Champ
          libelle={t("Fichier", "File")}
          type="file"
          required
          accept=".xlsx,.csv"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          erreur={erreurs.fichier}
        />
      </div>
      {echec ? (
        <Alerte tonalite="danger" titre={t("Import refusé", "Import rejected")}>
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
          titre={`${t("État", "Statement")} ${resultat.exercice}${t(" : ", ": ")}${statutEtat(resultat.statut, langue).libelle.toLowerCase()}`}
        >
          <p>
            {resultat.statut === "accepte"
              ? t(
                  "Tous les contrôles passent : l'état est accepté automatiquement.",
                  "All checks pass: the statement is accepted automatically.",
                )
              : t(
                  `${resultat.ecarts} écart(s), ${resultat.non_verifiables} contrôle(s) non vérifiable(s) : l'état attend une revue.`,
                  `${resultat.ecarts} gap(s), ${resultat.non_verifiables} check(s) that cannot be verified: the statement is awaiting review.`,
                )}{" "}
            <a
              href={`/dossiers/${encodeURIComponent(clientId)}/finances/${encodeURIComponent(resultat.id)}`}
            >
              {t("Voir le détail", "View details")}
            </a>
          </p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="telechargement"
          chargement={enCours}
          texteChargement={t("Import en cours…", "Importing…")}
        >
          {t("Importer et contrôler", "Import and check")}
        </Bouton>
      </div>
    </form>
  );
}

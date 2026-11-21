"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./ingestion.css";
import { Alerte } from "../ui/Alerte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { ErreurApi } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  auMoinsUnEnCours,
  erreurDocument,
  formaterTaille,
  libelleResultat,
  libelleUsage,
  listerDocumentsIngestion,
  type ApiIngestion,
  type DocumentIngestion,
} from "../../lib/ingestion";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { StatutDocument } from "./StatutDocument";

/** Intervalle de rafraîchissement tant qu'un document est en cours de lecture. */
export const INTERVALLE_RAFRAICHISSEMENT_MS = 3000;

export interface ListeDocumentsIngestionProps {
  /** Chemins d'API du domaine (dossier, due diligence ou standard). */
  api: ApiIngestion;
  /** Documents déjà chargés par le serveur (évite un affichage vide au premier rendu). */
  documentsInitiaux?: readonly DocumentIngestion[];
  limite?: number;
  /** Lien vers le détail d'un document. */
  hrefDocument: (doc: DocumentIngestion) => string;
  /** Lien vers l'objet créé (ex. état financier) ; null si aucun. */
  hrefResultat?: (doc: DocumentIngestion) => { href: string; libelle: string } | null;
  /** Rendu des liens (par défaut des ancres `<a>`) : permet d'utiliser `next/link`. */
  rendreLien?: (href: string, libelle: string) => ReactNode;
  afficherUsage?: boolean;
  legende?: string;
  messageVide?: string;
  /** Appelé quand plus aucun document n'est en cours alors qu'il y en avait (ex. rafraîchir la page). */
  onTermine?: () => void;
}

const lienParDefaut = (href: string, libelle: string) => <a href={href}>{libelle}</a>;

/**
 * Liste des documents ingérés : statut, résultat, pages, erreur, auteur, date. Tant qu'un
 * document est en cours, la liste se rafraîchit toutes les 3 s (annoncé poliment) ; la
 * minuterie s'arrête dès qu'il n'y en a plus et au démontage. Rien n'est mis en cache dans le
 * navigateur.
 */
export function ListeDocumentsIngestion({
  api,
  documentsInitiaux = [],
  limite = 30,
  hrefDocument,
  hrefResultat,
  rendreLien = lienParDefaut,
  afficherUsage = false,
  legende,
  messageVide,
  onTermine,
}: ListeDocumentsIngestionProps) {
  const t = useT();
  const langue = useLangue();
  const [documents, setDocuments] = useState<readonly DocumentIngestion[]>(documentsInitiaux);
  const [annonce, setAnnonce] = useState("");
  const [echec, setEchec] = useState<string | null>(null);
  const enCours = auMoinsUnEnCours(documents);
  const etaitEnCours = useRef(enCours);
  const rappel = useRef(onTermine);
  const apiRef = useRef(api);
  apiRef.current = api;
  rappel.current = onTermine;

  // Les documents du serveur (après un rafraîchissement de la page) remplacent l'état local.
  useEffect(() => {
    setDocuments(documentsInitiaux);
  }, [documentsInitiaux]);

  useEffect(() => {
    if (etaitEnCours.current && !enCours) {
      setAnnonce(
        t("La lecture des documents est terminée.", "Reading of the documents is complete."),
      );
      rappel.current?.();
    } else if (enCours) {
      setAnnonce(
        t(
          "Lecture en cours : la liste se met à jour automatiquement toutes les 3 secondes.",
          "Reading in progress: the list updates automatically every 3 seconds.",
        ),
      );
    }
    etaitEnCours.current = enCours;
  }, [enCours]);

  useEffect(() => {
    if (!enCours) return;
    const controle = new AbortController();
    let occupe = false;
    const minuterie = setInterval(() => {
      if (occupe) return;
      occupe = true;
      listerDocumentsIngestion(apiRef.current, { limite, signal: controle.signal })
        .then((page) => {
          setDocuments(page.elements);
          setEchec(null);
        })
        .catch((e: unknown) => {
          if (e instanceof ErreurApi && e.code === "ANNULE") return;
          setEchec(
            t(
              "L'actualisation automatique a échoué ; nouvel essai dans quelques secondes.",
              "Automatic refresh failed; trying again in a few seconds.",
            ),
          );
        })
        .finally(() => {
          occupe = false;
        });
    }, INTERVALLE_RAFRAICHISSEMENT_MS);
    return () => {
      clearInterval(minuterie);
      controle.abort();
    };
  }, [enCours, api.liste, limite]);

  const colonnes: ColonneTableau<DocumentIngestion>[] = [
    {
      cle: "nom",
      entete: t("Document", "Document"),
      rendu: (d) => (
        <>
          {rendreLien(hrefDocument(d), d.nom)}
          <span className="mp-ing-sous-ligne">
            {d.format === "pdf" ? "PDF" : "Excel"} · {formaterTaille(d.taille, langue)}
          </span>
        </>
      ),
    },
  ];
  if (afficherUsage) {
    colonnes.push({ cle: "usage", entete: "Usage", rendu: (d) => libelleUsage(d.usage, langue) });
  }
  colonnes.push(
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (d) => <StatutDocument statut={d.statut} />,
    },
    {
      cle: "resultat",
      entete: t("Résultat", "Result"),
      rendu: (d) => {
        const lien = hrefResultat?.(d);
        return (
          <>
            {d.statut === "echec"
              ? (erreurDocument(d, langue) ?? "—")
              : libelleResultat(d.resultat, langue)}
            {lien ? (
              <span className="mp-ing-sous-ligne">{rendreLien(lien.href, lien.libelle)}</span>
            ) : null}
          </>
        );
      },
    },
    {
      cle: "pages",
      entete: "Pages",
      alignement: "droite",
      rendu: (d) => (d.nb_pages === null ? "—" : String(d.nb_pages)),
    },
    { cle: "auteur", entete: t("Auteur", "Author"), rendu: (d) => d.cree_par.nom },
    {
      cle: "date",
      entete: "Date",
      rendu: (d) => (d.cree_le ? formaterDateHeure(d.cree_le, undefined, langue) : "—"),
    },
  );

  return (
    <div>
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      {echec ? (
        <Alerte tonalite="attention" annonce="alert">
          <p>{echec}</p>
        </Alerte>
      ) : null}
      <Tableau
        legende={legende ?? t("Documents importés", "Imported documents")}
        lignes={documents}
        cleLigne={(d) => d.id}
        messageVide={messageVide ?? t("Aucun document importé.", "No documents imported.")}
        colonnes={colonnes}
      />
    </div>
  );
}

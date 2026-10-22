"use client";

import "../ingestion/ingestion.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { DecisionExtraction } from "../ingestion/DecisionExtraction";
import { StatutExtraction } from "../ingestion/StatutExtraction";
import { formaterDateHeure } from "../../lib/format";
import {
  hrefPageCitee,
  messageErreur,
  modifierExtraction,
  type ApiIngestion,
  type ExtractionIngestion,
  type ExtractionProposition,
} from "../../lib/ingestion";
import {
  compterProposition,
  extractionOuverte,
  FAMILLES_PROPOSITION,
  libelleFamilleApplication,
  libelleMotifIgnore,
  libelleTypeElementMethode,
  LIBELLES_FAMILLE_PROPOSITION,
  lireResultatApplication,
  retirerDeProposition,
  totalCrees,
  totalProposition,
  type FamilleProposition,
} from "../../lib/ingestion-extractions";

export interface AmorcagePropositionProps {
  api: ApiIngestion;
  extraction: ExtractionProposition;
  /** Adresse de la page du document (sans requête) : sert aux liens vers les pages citées. */
  hrefDocument: string;
  /** Lien de retour vers l'éditeur de la version de méthode. */
  hrefEditeur: string;
  peutCorriger: boolean;
  peutDecider: boolean;
  /** La version cible est publiée : la validation (qui ajoute au brouillon) est impossible. */
  versionPubliee: boolean;
}

/** Bandeau affiché tant que la proposition n'est pas tranchée. */
export const BANDEAU_PROPOSITION =
  "Brouillon produit par l'IA : rien n'est appliqué ni publié tant que vous n'avez pas validé. La validation ajoute les éléments retenus au BROUILLON de la méthode (briques en risque R3, autonomie N1, inactives par défaut) ; la publication reste une étape séparée de l'éditeur.";

/**
 * Proposition d'amorçage du standard (STD-13) : étapes, briques, éléments et rubriques à cinq
 * niveaux, chacune avec sa page citée. L'expert retire ce qu'il ne retient pas, puis valide
 * (ajout au brouillon de la méthode) ou rejette avec un motif. Rien n'est publié d'ici.
 */
export function AmorcageProposition({
  api,
  extraction: initiale,
  hrefDocument,
  hrefEditeur,
  peutCorriger,
  peutDecider,
  versionPubliee,
}: AmorcagePropositionProps) {
  const router = useRouter();
  const [x, setX] = useState<ExtractionProposition>(initiale);
  const [occupe, setOccupe] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  const [aRetirer, setARetirer] = useState<{ famille: FamilleProposition; index: number } | null>(
    null,
  );

  useEffect(() => {
    setX(initiale);
  }, [initiale]);

  const c = x.contenu;
  const ouvert = extractionOuverte(x.statut);
  const nombres = compterProposition(c);
  const application = x.statut === "valide" ? lireResultatApplication(x.resultat) : null;

  async function retirer(famille: FamilleProposition, index: number) {
    setOccupe(true);
    setEchec(null);
    try {
      const vue = await modifierExtraction(api, x.id, retirerDeProposition(c, famille, index));
      if (vue.nature === "standard_proposition") setX(vue);
      setAnnonce("Élément retiré de la proposition.");
      setARetirer(null);
      router.refresh();
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setOccupe(false);
    }
  }

  function apresDecision(vue: ExtractionIngestion) {
    if (vue.nature === "standard_proposition") setX(vue);
    router.refresh();
  }

  const retrait = (famille: FamilleProposition, index: number) =>
    ouvert && peutCorriger ? (
      <div className="mp-ing-actions">
        {aRetirer?.famille === famille && aRetirer.index === index ? (
          <>
            <Bouton
              variante="danger"
              chargement={occupe}
              texteChargement="Retrait…"
              onClick={() => void retirer(famille, index)}
            >
              Confirmer le retrait
            </Bouton>
            <Bouton variante="discret" disabled={occupe} onClick={() => setARetirer(null)}>
              Garder
            </Bouton>
          </>
        ) : (
          <Bouton
            variante="discret"
            disabled={occupe}
            onClick={() => setARetirer({ famille, index })}
          >
            Retirer de la proposition
          </Bouton>
        )}
      </div>
    ) : null;

  const lienPage = (page: number) => (
    <Link href={hrefPageCitee(hrefDocument, page)}>{`Page ${page}`}</Link>
  );

  return (
    <div className="mp-ing-pile">
      <div className="mp-ing-entete">
        <StatutExtraction statut={x.statut} />
        {x.modifie_par ? (
          <span className="mp-texte-petit">
            {`Corrigée par ${x.modifie_par.nom}${x.modifie_le ? ` le ${formaterDateHeure(x.modifie_le)}` : ""}`}
          </span>
        ) : null}
        {x.valide_par ? (
          <span className="mp-texte-petit">
            {`${x.statut === "rejete" ? "Rejetée" : "Validée"} par ${x.valide_par.nom}${x.valide_le ? ` le ${formaterDateHeure(x.valide_le)}` : ""}`}
          </span>
        ) : null}
      </div>

      {ouvert ? (
        <Alerte tonalite="attention" titre="Proposition de l'IA à relire" annonce="aucune">
          <p>{BANDEAU_PROPOSITION}</p>
        </Alerte>
      ) : x.statut === "rejete" ? (
        <Alerte tonalite="info" titre="Proposition rejetée" annonce="aucune">
          <p>{`Motif : ${x.motif_rejet ?? "non précisé"}. Rien n'a été ajouté à la méthode.`}</p>
        </Alerte>
      ) : null}

      {application ? (
        <Alerte tonalite="succes" titre="Proposition appliquée au brouillon de la méthode">
          <p>
            {`${totalCrees(application)} élément(s) ajouté(s) : ${application.crees.etapes} étape(s), ${application.crees.briques} brique(s), ${application.crees.elements} élément(s), ${application.crees.rubriques} rubrique(s).`}
          </p>
          <p>
            Les briques ajoutées sont inactives, en risque R3 et en autonomie N1 : ajustez-les dans
            l&apos;éditeur, puis publiez la méthode depuis l&apos;éditeur.
          </p>
          {application.ignores.length > 0 ? (
            <>
              <p>{`${application.ignores.length} élément(s) ignoré(s) :`}</p>
              <ul className="mp-liste-simple" aria-label="Éléments ignorés">
                {application.ignores.map((i) => (
                  <li key={`${i.famille}-${i.code}`}>
                    {`${libelleFamilleApplication(i.famille)} ${i.code} : ${libelleMotifIgnore(i.motif)}`}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Aucun élément ignoré.</p>
          )}
        </Alerte>
      ) : null}

      {x.statut === "valide" ? (
        <p>
          <Link href={hrefEditeur}>Ouvrir l&apos;éditeur de la méthode</Link>
        </p>
      ) : null}

      {c.tronque ? (
        <Alerte tonalite="attention" titre="Document lu en partie" annonce="aucune">
          <p>
            Le texte transmis à l&apos;IA a été limité : la fin du document n&apos;a pas été lue.
          </p>
        </Alerte>
      ) : null}

      {totalProposition(c) === 0 ? <p className="mp-texte-doux">La proposition est vide.</p> : null}

      {FAMILLES_PROPOSITION.map((famille) => (
        <section key={famille} aria-labelledby={`titre-${famille}`} className="mp-ing-pile">
          <h3 id={`titre-${famille}`} className="mp-carte__titre">
            {`${LIBELLES_FAMILLE_PROPOSITION[famille]} (${nombres[famille]})`}
          </h3>
          {nombres[famille] === 0 ? (
            <p className="mp-texte-doux">Aucun élément dans cette famille.</p>
          ) : (
            <ul className="mp-ing-liste" aria-label={LIBELLES_FAMILLE_PROPOSITION[famille]}>
              {famille === "etapes"
                ? c.etapes.map((e, i) => (
                    <li key={`${e.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{e.libelle}</p>
                        <span className="mp-texte-petit">{`Code ${e.code}`}</span>
                        {lienPage(e.page)}
                      </div>
                      {retrait("etapes", i)}
                    </li>
                  ))
                : null}
              {famille === "briques"
                ? c.briques.map((b, i) => (
                    <li key={`${b.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{b.libelle}</p>
                        <span className="mp-texte-petit">{`Code ${b.code} · étape ${b.etape_code}`}</span>
                        {lienPage(b.page)}
                      </div>
                      <p className="mp-ing-meta">{b.objet}</p>
                      {retrait("briques", i)}
                    </li>
                  ))
                : null}
              {famille === "elements"
                ? c.elements.map((el, i) => (
                    <li key={`${el.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <BadgeStatut tonalite="neutre" sansIcone>
                          {libelleTypeElementMethode(el.type)}
                        </BadgeStatut>
                        <p className="mp-ing-enonce">{el.libelle}</p>
                        <span className="mp-texte-petit">
                          {`Code ${el.code}${el.brique_code ? ` · brique ${el.brique_code}` : ""}`}
                        </span>
                        {lienPage(el.page)}
                      </div>
                      {el.description ? <p className="mp-ing-meta">{el.description}</p> : null}
                      {retrait("elements", i)}
                    </li>
                  ))
                : null}
              {famille === "rubriques"
                ? c.rubriques.map((r, i) => (
                    <li key={`${r.code}-${i}`} className="mp-ing-element">
                      <div className="mp-ing-entete">
                        <p className="mp-ing-enonce">{r.libelle}</p>
                        <span className="mp-texte-petit">{`Code ${r.code}`}</span>
                        {lienPage(r.page)}
                      </div>
                      <ol aria-label={`Cinq niveaux de la rubrique ${r.libelle}`}>
                        {r.niveaux.map((n, k) => (
                          <li key={k}>{`Niveau ${k + 1} : ${n}`}</li>
                        ))}
                      </ol>
                      {retrait("rubriques", i)}
                    </li>
                  ))
                : null}
            </ul>
          )}
        </section>
      ))}

      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      {echec ? (
        <Alerte tonalite="danger" titre="Retrait refusé">
          <p>{echec}</p>
        </Alerte>
      ) : null}

      {ouvert && peutDecider ? (
        <section aria-labelledby="titre-decision" className="mp-ing-pile">
          <h3 id="titre-decision" className="mp-carte__titre">
            Décision
          </h3>
          <DecisionExtraction
            api={api}
            extraction={x}
            nonVerifies={x.chiffres_non_verifies}
            libelleValider="Valider et ajouter au brouillon de la méthode"
            raisonValidationImpossible={
              versionPubliee
                ? "Cette version de méthode est publiée : la proposition ne peut plus lui être ajoutée. Vous pouvez la rejeter."
                : undefined
            }
            aide="La validation ajoute les éléments retenus au brouillon ; la publication de la méthode reste une étape séparée de l'éditeur."
            onDecide={apresDecision}
          />
        </section>
      ) : ouvert ? (
        <p className="mp-texte-doux">
          Seul un expert autorisé à gérer le standard peut valider ou rejeter cette proposition.
        </p>
      ) : null}
    </div>
  );
}
